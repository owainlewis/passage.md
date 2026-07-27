package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestRegisterCreatesHttpOnlySessionAndMeReadsIt(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)
	service.now = func() time.Time { return time.Unix(100, 0).UTC() }

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"USER@example.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	service.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	cookie := rec.Result().Cookies()[0]
	if cookie.Name != CookieName {
		t.Fatalf("cookie name = %q", cookie.Name)
	}
	if !cookie.HttpOnly {
		t.Fatal("session cookie is not HttpOnly")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("same-site = %v", cookie.SameSite)
	}

	me := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	meReq.AddCookie(cookie)
	service.Me(me, meReq)

	if me.Code != http.StatusOK {
		t.Fatalf("me status = %d", me.Code)
	}
	if !strings.Contains(me.Body.String(), `"authenticated":true`) {
		t.Fatalf("me body = %s", me.Body.String())
	}
	if !strings.Contains(me.Body.String(), `"email":"user@example.com"`) {
		t.Fatalf("me body = %s", me.Body.String())
	}
}

func TestLoginRejectsWrongPassword(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)
	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"u@example.com","password":"wrongpass"}`))
	req.Header.Set("Content-Type", "application/json")
	service.Login(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestLoginReturnsServerErrorForStoreFailure(t *testing.T) {
	store := newMemoryStore()
	store.findErr = errors.New("database unavailable")
	service := NewService(store, "test-secret", false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	service.Login(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestPasswordResetRequestQueuesGenericResponseAndWorkerSendsHashedToken(t *testing.T) {
	store := newResetTestStore()
	sender := &recordingPasswordResetSender{}
	service := NewServiceWithOptions(store, "test-secret", false, Options{
		AppBaseURL:          "https://passage.md",
		PasswordResetSender: sender,
	})
	fixedNow := time.Date(2026, time.July, 21, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":" Person@Example.com "}`))
	req.Header.Set("Content-Type", "application/json")
	service.RequestPasswordReset(rec, req)

	if rec.Code != http.StatusAccepted || !strings.Contains(rec.Body.String(), "If an account exists") {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.queuedEmail != "person@example.com" || sender.email != "" {
		t.Fatalf("queued email = %q, delivered email = %q", store.queuedEmail, sender.email)
	}
	store.claim = PasswordResetRequest{ID: "request-id", Email: store.queuedEmail, Attempts: 1}
	processed, err := service.processPasswordResetRequest(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed = %v, error = %v", processed, err)
	}
	if sender.email != "person@example.com" || !strings.HasPrefix(sender.resetURL, "https://passage.md/reset-password#token=") {
		t.Fatalf("sent email = %q, URL = %q", sender.email, sender.resetURL)
	}
	plainToken := strings.TrimPrefix(sender.resetURL, "https://passage.md/reset-password#token=")
	if store.tokenHash != hashToken(plainToken) || store.expiresAt != fixedNow.Add(time.Hour) || strings.Contains(rec.Body.String(), plainToken) {
		t.Fatal("reset token was not stored and returned safely")
	}
	if sender.idempotencyKey != "password-reset-request-id" {
		t.Fatalf("idempotency key = %q", sender.idempotencyKey)
	}

	firstURL := sender.resetURL
	store.claim = PasswordResetRequest{ID: "request-id", Email: store.queuedEmail, Attempts: 2}
	if _, err := service.processPasswordResetRequest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if sender.resetURL != firstURL || sender.idempotencyKey != "password-reset-request-id" {
		t.Fatalf("retry changed payload or key: URL = %q, key = %q", sender.resetURL, sender.idempotencyKey)
	}
}

func TestDirectClientIPIgnoresForwardedHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.20, 203.0.113.30")

	if got := directClientIP(req); got != "192.0.2.10" {
		t.Fatalf("client IP = %q", got)
	}
}

func TestPasswordResetRequestDoesNotRevealQueueOrRateLimitState(t *testing.T) {
	for _, test := range []struct {
		name     string
		queueErr error
		rateErr  error
	}{
		{name: "unknown or queue failure", queueErr: errors.New("database unavailable")},
		{name: "rate limited", rateErr: ErrRateLimited},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := newResetTestStore()
			store.queueErr = test.queueErr
			store.rateErr = test.rateErr
			service := NewServiceWithOptions(store, "test-secret", false, Options{AppBaseURL: "https://passage.md", PasswordResetSender: &recordingPasswordResetSender{}})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"person@example.com"}`))
			req.Header.Set("Content-Type", "application/json")
			service.RequestPasswordReset(rec, req)
			if rec.Code != http.StatusAccepted || !strings.Contains(rec.Body.String(), "If an account exists") {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestPasswordResetQueueFailureLogsSafeRequestContext(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	store := newResetTestStore()
	store.queueErr = errors.New("database unavailable")
	service := NewServiceWithOptions(store, "test-secret", false, Options{
		AppBaseURL:          "https://passage.md",
		PasswordResetSender: &recordingPasswordResetSender{},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"private@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	service.RequestPasswordReset(rec, req)

	logged := output.String()
	for _, want := range []string{`"route":"/api/v1/auth/password-reset/request"`, `"operation":"queue password reset request"`, `"error":"database unavailable"`} {
		if !strings.Contains(logged, want) {
			t.Fatalf("log %q does not contain %q", logged, want)
		}
	}
	if strings.Contains(logged, "private@example.com") {
		t.Fatalf("password reset email was logged: %s", logged)
	}
}

func TestPasswordResetDeliveryFailureStaysObservableWhenRetrySchedulingFails(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	store := newResetTestStore()
	store.claim = PasswordResetRequest{ID: "safe-request-id", Email: "private@example.com", Attempts: 2}
	store.retryErr = errors.New("retry database unavailable")
	sender := &recordingPasswordResetSender{err: errors.New("email provider unavailable")}
	service := NewServiceWithOptions(store, "test-secret", false, Options{
		AppBaseURL:          "https://passage.md",
		PasswordResetSender: sender,
	})

	processed, err := service.processPasswordResetRequest(context.Background())

	if !processed || err == nil {
		t.Fatalf("processed = %v, error = %v", processed, err)
	}
	logged := output.String()
	for _, want := range []string{
		`"operation":"process password reset delivery"`,
		`"operation":"schedule password reset retry"`,
		`"reset_request_id":"safe-request-id"`,
		`"error":"email provider unavailable"`,
		`"error":"retry database unavailable"`,
	} {
		if !strings.Contains(logged, want) {
			t.Fatalf("log %q does not contain %q", logged, want)
		}
	}
	if strings.Contains(logged, "private@example.com") || strings.Contains(logged, sender.resetURL) {
		t.Fatalf("password reset email or URL was logged: %s", logged)
	}
}

func TestResetPasswordHashesPasswordAndRejectsReusedToken(t *testing.T) {
	store := newResetTestStore()
	store.tokenValid = true
	service := NewService(store, "test-secret", false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_secret","password":"a new secure password"}`))
	req.Header.Set("Content-Type", "application/json")
	service.ResetPassword(rec, req)
	if rec.Code != http.StatusOK || store.resetTokenHash != hashToken("reset_secret") {
		t.Fatalf("status = %d, token hash = %q", rec.Code, store.resetTokenHash)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.passwordHash), []byte("a new secure password")) != nil {
		t.Fatal("new password was not bcrypt hashed")
	}
	if cookies := rec.Result().Cookies(); len(cookies) != 1 || cookies[0].Name != CookieName || cookies[0].MaxAge != -1 {
		t.Fatalf("cookies = %#v", cookies)
	}

	store.tokenValid = false
	store.resetErr = ErrInvalidResetToken
	reused := httptest.NewRecorder()
	reusedReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_secret","password":"another secure password"}`))
	reusedReq.Header.Set("Content-Type", "application/json")
	service.ResetPassword(reused, reusedReq)
	if reused.Code != http.StatusBadRequest || !strings.Contains(reused.Body.String(), "invalid or has expired") {
		t.Fatalf("status = %d, body = %s", reused.Code, reused.Body.String())
	}
}

func TestResetPasswordRateLimitsBeforeHashing(t *testing.T) {
	store := newResetTestStore()
	store.tokenValid = true
	store.confirmRateErr = ErrRateLimited
	service := NewService(store, "test-secret", false)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_secret","password":"a new secure password"}`))
	req.Header.Set("Content-Type", "application/json")
	service.ResetPassword(rec, req)
	if rec.Code != http.StatusTooManyRequests || store.passwordHash != "" || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("status = %d, password hash = %q, Retry-After = %q", rec.Code, store.passwordHash, rec.Header().Get("Retry-After"))
	}
}

func TestRegisterRequiresJSONContentTypeAndSameOrigin(t *testing.T) {
	service := NewService(newMemoryStore(), "test-secret", false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	req.Header.Set("Content-Type", "text/plain")
	service.Register(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("content-type status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://evil.test")
	service.Register(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("origin status = %d", rec.Code)
	}
}

func TestLogoutDeletesServerSession(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)
	cookie := register.Result().Cookies()[0]

	logout := httptest.NewRecorder()
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	logoutReq.AddCookie(cookie)
	service.Logout(logout, logoutReq)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout status = %d", logout.Code)
	}

	me := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	meReq.AddCookie(cookie)
	service.Me(me, meReq)
	if body := me.Body.String(); !strings.Contains(body, `"authenticated":false`) {
		t.Fatalf("me body = %s", body)
	}
}

func TestLogoutReportsDeleteFailure(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)
	cookie := register.Result().Cookies()[0]
	store.deleteErr = errors.New("database unavailable")

	logout := httptest.NewRecorder()
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	logoutReq.AddCookie(cookie)
	service.Logout(logout, logoutReq)
	if logout.Code != http.StatusInternalServerError {
		t.Fatalf("logout status = %d", logout.Code)
	}
}

func TestRequireUserRejectsAnonymousRequests(t *testing.T) {
	service := NewService(newMemoryStore(), "test-secret", false)
	handler := service.RequireUser(func(w http.ResponseWriter, r *http.Request, user User) {
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/private", nil)
	handler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAPITokenCreateListBearerAuthAndRevoke(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)
	user := User{ID: "user-1", Email: "u@example.com"}

	create := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/api-tokens", strings.NewReader(`{"name":"Laptop"}`))
	createReq.Header.Set("Content-Type", "application/json")
	service.CreateAPIToken(create, createReq, user)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	var created createAPITokenResponse
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(created.Token, "psg_") {
		t.Fatalf("token = %q, want psg_ prefix", created.Token)
	}
	if created.APIToken.Name != "Laptop" {
		t.Fatalf("apiToken name = %q", created.APIToken.Name)
	}
	if store.lastAPITokenHash == "" || store.lastAPITokenHash == created.Token {
		t.Fatalf("stored token hash = %q, plaintext = %q", store.lastAPITokenHash, created.Token)
	}

	list := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/api-tokens", nil)
	service.ListAPITokens(list, listReq, user)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
	}
	if strings.Contains(list.Body.String(), created.Token) {
		t.Fatalf("list leaked plaintext token: %s", list.Body.String())
	}

	bearer := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	bearer.Header.Set("Authorization", "Bearer "+created.Token)
	if got, ok := service.UserFromRequest(bearer); !ok || got.ID != user.ID {
		t.Fatalf("bearer user = %#v, ok = %v", got, ok)
	}

	revoke := httptest.NewRecorder()
	revokeReq := httptest.NewRequest(http.MethodDelete, "http://passage.test/api/v1/api-tokens/"+created.APIToken.ID, nil)
	revokeReq.SetPathValue("id", created.APIToken.ID)
	service.RevokeAPIToken(revoke, revokeReq, user)
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, body = %s", revoke.Code, revoke.Body.String())
	}
	if _, ok := service.UserFromRequest(bearer); ok {
		t.Fatal("revoked bearer token still authenticated")
	}
}

func TestRequireUserAcceptsBearerToken(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)
	user := User{ID: "user-1", Email: "u@example.com"}
	plain := "psg_test-token"
	store.apiTokens[hashToken(plain)] = memoryAPIToken{
		user:      user,
		tokenHash: hashToken(plain),
		token: APIToken{
			ID:        "11111111-1111-1111-1111-111111111111",
			Name:      "Test",
			CreatedAt: time.Unix(100, 0).UTC(),
		},
	}
	handler := service.RequireUser(func(w http.ResponseWriter, r *http.Request, got User) {
		if got.ID != user.ID {
			t.Fatalf("user = %#v", got)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	req.Header.Set("Authorization", "Bearer "+plain)
	handler(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestRequireSessionUserRejectsBearerToken(t *testing.T) {
	store := newMemoryStore()
	service := NewService(store, "test-secret", false)
	plain := "psg_test-token"
	store.apiTokens[hashToken(plain)] = memoryAPIToken{
		user:      User{ID: "user-1", Email: "u@example.com"},
		tokenHash: hashToken(plain),
		token: APIToken{
			ID:        "11111111-1111-1111-1111-111111111111",
			Name:      "Test",
			CreatedAt: time.Unix(100, 0).UTC(),
		},
	}
	handler := service.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user User) {
		w.WriteHeader(http.StatusNoContent)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/api-tokens", nil)
	req.Header.Set("Authorization", "Bearer "+plain)
	handler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

type memoryStore struct {
	users            map[string]UserWithPassword
	sessions         map[string]User
	apiTokens        map[string]memoryAPIToken
	nextID           int
	nextTokenID      int
	lastAPITokenHash string
	findErr          error
	deleteErr        error
}

type recordingPasswordResetSender struct {
	email          string
	resetURL       string
	idempotencyKey string
	err            error
}

func (s *recordingPasswordResetSender) SendPasswordReset(_ context.Context, email string, resetURL string, idempotencyKey string) error {
	s.email = email
	s.resetURL = resetURL
	s.idempotencyKey = idempotencyKey
	return s.err
}

type resetTestStore struct {
	*memoryStore
	queuedEmail    string
	queueErr       error
	rateErr        error
	confirmRateErr error
	claim          PasswordResetRequest
	tokenHash      string
	expiresAt      time.Time
	tokenValid     bool
	resetTokenHash string
	passwordHash   string
	resetErr       error
	retryErr       error
	completedID    string
	retriedID      string
	retryAt        time.Time
}

func newResetTestStore() *resetTestStore {
	return &resetTestStore{memoryStore: newMemoryStore()}
}

func (s *resetTestStore) ConsumePasswordResetAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return time.Minute, s.rateErr
}

func (s *resetTestStore) ConsumePasswordResetConfirmationAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return time.Minute, s.confirmRateErr
}

func (s *resetTestStore) QueuePasswordResetRequest(_ context.Context, email string, _ time.Time) error {
	s.queuedEmail = email
	return s.queueErr
}

func (s *resetTestStore) ClaimPasswordResetRequest(context.Context, time.Time) (PasswordResetRequest, error) {
	if s.claim.ID == "" {
		return PasswordResetRequest{}, ErrNoPendingReset
	}
	return s.claim, nil
}

func (s *resetTestStore) CompletePasswordResetRequest(_ context.Context, id string, _ time.Time) error {
	s.completedID = id
	s.claim = PasswordResetRequest{}
	return nil
}

func (s *resetTestStore) RetryPasswordResetRequest(_ context.Context, id string, availableAt time.Time) error {
	s.retriedID = id
	s.retryAt = availableAt
	return s.retryErr
}

func (s *resetTestStore) CreatePasswordResetToken(_ context.Context, _ string, tokenHash string, expiresAt time.Time) error {
	s.tokenHash = tokenHash
	s.expiresAt = expiresAt
	s.tokenValid = true
	return nil
}

func (s *resetTestStore) PasswordResetTokenValid(context.Context, string, time.Time) (bool, error) {
	return s.tokenValid, nil
}

func (s *resetTestStore) ResetPassword(_ context.Context, tokenHash string, passwordHash string, _ time.Time) error {
	s.resetTokenHash = tokenHash
	s.passwordHash = passwordHash
	if s.resetErr == nil {
		s.tokenValid = false
	}
	return s.resetErr
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:       map[string]UserWithPassword{},
		sessions:    map[string]User{},
		apiTokens:   map[string]memoryAPIToken{},
		nextID:      1,
		nextTokenID: 1,
	}
}

type memoryAPIToken struct {
	user      User
	token     APIToken
	tokenHash string
	revoked   bool
}

func (s *memoryStore) CreateUser(ctx context.Context, email string, passwordHash string) (User, error) {
	if _, exists := s.users[email]; exists {
		return User{}, ErrEmailTaken
	}
	user := User{ID: string(rune('0' + s.nextID)), Email: email}
	s.nextID++
	s.users[email] = UserWithPassword{User: user, PasswordHash: passwordHash}
	return user, nil
}

func (s *memoryStore) FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error) {
	if s.findErr != nil {
		return UserWithPassword{}, s.findErr
	}
	user, ok := s.users[email]
	if !ok {
		return UserWithPassword{}, ErrInvalidAuth
	}
	return user, nil
}

func (s *memoryStore) FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	user, ok := s.sessions[tokenHash]
	if !ok {
		return User{}, ErrUnauthorized
	}
	return user, nil
}

func (s *memoryStore) CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	for _, account := range s.users {
		if account.ID == userID {
			s.sessions[tokenHash] = account.User
			return nil
		}
	}
	return errors.New("missing user")
}

func (s *memoryStore) DeleteSession(ctx context.Context, tokenHash string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	delete(s.sessions, tokenHash)
	return nil
}

func (s *memoryStore) ListAPITokens(ctx context.Context, userID string) ([]APIToken, error) {
	var tokens []APIToken
	for _, record := range s.apiTokens {
		if record.user.ID == userID && !record.revoked {
			tokens = append(tokens, record.token)
		}
	}
	return tokens, nil
}

func (s *memoryStore) CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error) {
	token := APIToken{
		ID:        fmt.Sprintf("11111111-1111-1111-1111-%012d", s.nextTokenID),
		Name:      name,
		CreatedAt: time.Unix(100+int64(s.nextTokenID), 0).UTC(),
	}
	s.nextTokenID++
	s.lastAPITokenHash = tokenHash
	s.apiTokens[tokenHash] = memoryAPIToken{
		user:      User{ID: userID, Email: "u@example.com"},
		token:     token,
		tokenHash: tokenHash,
	}
	return token, nil
}

func (s *memoryStore) RevokeAPIToken(ctx context.Context, userID string, id string) error {
	for hash, record := range s.apiTokens {
		if record.user.ID == userID && record.token.ID == id && !record.revoked {
			record.revoked = true
			s.apiTokens[hash] = record
			return nil
		}
	}
	return ErrUnauthorized
}

func (s *memoryStore) FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	record, ok := s.apiTokens[tokenHash]
	if !ok || record.revoked {
		return User{}, ErrUnauthorized
	}
	return record.user, nil
}
