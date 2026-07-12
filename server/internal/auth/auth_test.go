package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
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

func TestRequestMagicLinkSendsLinkForExistingUser(t *testing.T) {
	store := newMemoryStore()
	sender := &fakeMagicLinkSender{}
	service := NewService(store, "test-secret", false, WithMagicLinkSender(sender), WithAppBaseURL("http://passage.test"))

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link", strings.NewReader(`{"email":"U@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	service.RequestMagicLink(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if sender.calls != 1 {
		t.Fatalf("sender calls = %d", sender.calls)
	}
	if sender.email != "u@example.com" {
		t.Fatalf("sender email = %q", sender.email)
	}
	if !strings.HasPrefix(sender.link, "http://passage.test/login/magic-link?token=") {
		t.Fatalf("sender link = %q", sender.link)
	}
}

func TestRequestMagicLinkPreservesSafeNextPath(t *testing.T) {
	store := newMemoryStore()
	sender := &fakeMagicLinkSender{}
	service := NewService(store, "test-secret", false, WithMagicLinkSender(sender), WithAppBaseURL("http://passage.test"))

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link", strings.NewReader(`{"email":"u@example.com","next":"/account?billing=success"}`))
	req.Header.Set("Content-Type", "application/json")
	service.RequestMagicLink(rec, req)

	link, err := url.Parse(sender.link)
	if err != nil {
		t.Fatal(err)
	}
	if got := link.Query().Get("next"); got != "/account?billing=success" {
		t.Fatalf("next = %q, want account path", got)
	}
}

func TestRequestMagicLinkDropsUnsafeNextPath(t *testing.T) {
	store := newMemoryStore()
	sender := &fakeMagicLinkSender{}
	service := NewService(store, "test-secret", false, WithMagicLinkSender(sender), WithAppBaseURL("http://passage.test"))

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link", strings.NewReader(`{"email":"u@example.com","next":"//evil.test"}`))
	req.Header.Set("Content-Type", "application/json")
	service.RequestMagicLink(rec, req)

	link, err := url.Parse(sender.link)
	if err != nil {
		t.Fatal(err)
	}
	if got := link.Query().Get("next"); got != "" {
		t.Fatalf("next = %q, want empty", got)
	}
}

func TestRequestMagicLinkDoesNotRevealUnknownEmail(t *testing.T) {
	store := newMemoryStore()
	sender := &fakeMagicLinkSender{}
	service := NewService(store, "test-secret", false, WithMagicLinkSender(sender))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link", strings.NewReader(`{"email":"nobody@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	service.RequestMagicLink(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if sender.calls != 0 {
		t.Fatalf("sender calls = %d, want 0", sender.calls)
	}
}

func TestVerifyMagicLinkCreatesSessionAndIsSingleUse(t *testing.T) {
	store := newMemoryStore()
	sender := &fakeMagicLinkSender{}
	service := NewService(store, "test-secret", false, WithMagicLinkSender(sender), WithAppBaseURL("http://passage.test"))

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)

	requestRec := httptest.NewRecorder()
	requestReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link", strings.NewReader(`{"email":"u@example.com"}`))
	requestReq.Header.Set("Content-Type", "application/json")
	service.RequestMagicLink(requestRec, requestReq)

	link, err := url.Parse(sender.link)
	if err != nil {
		t.Fatal(err)
	}
	token := link.Query().Get("token")
	if token == "" {
		t.Fatalf("missing token in link %q", sender.link)
	}

	verify := httptest.NewRecorder()
	verifyReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link/verify", strings.NewReader(fmt.Sprintf(`{"token":%q}`, token)))
	verifyReq.Header.Set("Content-Type", "application/json")
	service.VerifyMagicLink(verify, verifyReq)

	if verify.Code != http.StatusOK {
		t.Fatalf("verify status = %d, body = %s", verify.Code, verify.Body.String())
	}
	if !strings.Contains(verify.Body.String(), `"email":"u@example.com"`) {
		t.Fatalf("verify body = %s", verify.Body.String())
	}
	cookies := verify.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != CookieName {
		t.Fatalf("session cookie not set: %#v", cookies)
	}

	reuse := httptest.NewRecorder()
	reuseReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link/verify", strings.NewReader(fmt.Sprintf(`{"token":%q}`, token)))
	reuseReq.Header.Set("Content-Type", "application/json")
	service.VerifyMagicLink(reuse, reuseReq)
	if reuse.Code != http.StatusUnauthorized {
		t.Fatalf("reuse status = %d, body = %s", reuse.Code, reuse.Body.String())
	}
}

func TestVerifyMagicLinkRejectsExpiredToken(t *testing.T) {
	store := newMemoryStore()
	sender := &fakeMagicLinkSender{}
	service := NewService(store, "test-secret", false, WithMagicLinkSender(sender))
	service.now = func() time.Time { return time.Unix(1000, 0).UTC() }

	register := httptest.NewRecorder()
	registerReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	registerReq.Header.Set("Content-Type", "application/json")
	service.Register(register, registerReq)

	requestRec := httptest.NewRecorder()
	requestReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link", strings.NewReader(`{"email":"u@example.com"}`))
	requestReq.Header.Set("Content-Type", "application/json")
	service.RequestMagicLink(requestRec, requestReq)

	link, err := url.Parse(sender.link)
	if err != nil {
		t.Fatal(err)
	}
	token := link.Query().Get("token")

	service.now = func() time.Time { return time.Unix(1000, 0).Add(time.Hour).UTC() }

	verify := httptest.NewRecorder()
	verifyReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link/verify", strings.NewReader(fmt.Sprintf(`{"token":%q}`, token)))
	verifyReq.Header.Set("Content-Type", "application/json")
	service.VerifyMagicLink(verify, verifyReq)
	if verify.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", verify.Code, verify.Body.String())
	}
}

func TestVerifyMagicLinkRejectsUnknownToken(t *testing.T) {
	service := NewService(newMemoryStore(), "test-secret", false)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/magic-link/verify", strings.NewReader(`{"token":"does-not-exist"}`))
	req.Header.Set("Content-Type", "application/json")
	service.VerifyMagicLink(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

type memoryStore struct {
	users            map[string]UserWithPassword
	sessions         map[string]User
	apiTokens        map[string]memoryAPIToken
	magicLinks       map[string]memoryMagicLinkToken
	nextID           int
	nextTokenID      int
	lastAPITokenHash string
	findErr          error
	deleteErr        error
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:       map[string]UserWithPassword{},
		sessions:    map[string]User{},
		apiTokens:   map[string]memoryAPIToken{},
		magicLinks:  map[string]memoryMagicLinkToken{},
		nextID:      1,
		nextTokenID: 1,
	}
}

type memoryMagicLinkToken struct {
	userID    string
	expiresAt time.Time
	used      bool
}

type fakeMagicLinkSender struct {
	calls int
	email string
	link  string
}

func (f *fakeMagicLinkSender) Send(_ context.Context, email string, link string) error {
	f.calls++
	f.email = email
	f.link = link
	return nil
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

func (s *memoryStore) CreateMagicLinkToken(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	s.magicLinks[tokenHash] = memoryMagicLinkToken{userID: userID, expiresAt: expiresAt}
	return nil
}

func (s *memoryStore) ConsumeMagicLinkToken(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	record, ok := s.magicLinks[tokenHash]
	if !ok || record.used || !now.Before(record.expiresAt) {
		return User{}, ErrInvalidAuth
	}
	record.used = true
	s.magicLinks[tokenHash] = record
	for _, account := range s.users {
		if account.ID == record.userID {
			return account.User, nil
		}
	}
	return User{}, ErrInvalidAuth
}
