package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/owainlewis/passage.md/server/internal/httpx"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName            = "passage_session"
	sessionDuration       = 30 * 24 * time.Hour
	passwordResetDuration = time.Hour
	passwordResetWindow   = 15 * time.Minute
	passwordResetLimit    = 5
	passwordConfirmWindow = 15 * time.Minute
	passwordConfirmLimit  = 10
)

var (
	ErrEmailTaken        = errors.New("email already exists")
	ErrInvalidAuth       = errors.New("invalid email or password")
	ErrUnauthorized      = errors.New("unauthorized")
	ErrRateLimited       = errors.New("rate limit reached")
	ErrInvalidResetToken = errors.New("invalid or expired password reset token")
	ErrNoPendingReset    = errors.New("no pending password reset request")
)

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type UserWithPassword struct {
	User
	PasswordHash string
}

type APIToken struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type PreparedSession struct {
	TokenHash   string
	CookieValue string
	ExpiresAt   time.Time
}

type PasswordResetRequest struct {
	ID       string
	Email    string
	Attempts int
}

type Store interface {
	CreateUser(ctx context.Context, email string, passwordHash string) (User, error)
	FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error)
	FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
	ListAPITokens(ctx context.Context, userID string) ([]APIToken, error)
	CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error)
	RevokeAPIToken(ctx context.Context, userID string, id string) error
	FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	FindUserByAPITokenHashReadOnly(ctx context.Context, tokenHash string) (User, error)
}

type PasswordResetStore interface {
	ConsumePasswordResetAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	ConsumePasswordResetConfirmationAttempt(ctx context.Context, ipHash string, tokenHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	QueuePasswordResetRequest(ctx context.Context, email string, now time.Time) error
	ClaimPasswordResetRequest(ctx context.Context, now time.Time) (PasswordResetRequest, error)
	CompletePasswordResetRequest(ctx context.Context, id string, now time.Time) error
	RetryPasswordResetRequest(ctx context.Context, id string, availableAt time.Time) error
	CreatePasswordResetToken(ctx context.Context, email string, tokenHash string, expiresAt time.Time) error
	PasswordResetTokenValid(ctx context.Context, tokenHash string, now time.Time) (bool, error)
	ResetPassword(ctx context.Context, tokenHash string, passwordHash string, now time.Time) error
}

type Options struct {
	AppBaseURL          string
	PasswordResetSender PasswordResetSender
	ClientIP            func(*http.Request) string
	WritesDisabled      bool
}

type Service struct {
	store               Store
	passwordResetStore  PasswordResetStore
	secret              []byte
	cookieSecure        bool
	appBaseURL          string
	passwordResetSender PasswordResetSender
	clientIP            func(*http.Request) string
	now                 func() time.Time
	writesDisabled      bool
}

func NewService(store Store, secret string, cookieSecure bool) *Service {
	return NewServiceWithOptions(store, secret, cookieSecure, Options{})
}

func NewServiceWithOptions(store Store, secret string, cookieSecure bool, options Options) *Service {
	resetStore, _ := store.(PasswordResetStore)
	clientIP := options.ClientIP
	if clientIP == nil {
		clientIP = directClientIP
	}
	return &Service{
		store:               store,
		passwordResetStore:  resetStore,
		secret:              []byte(secret),
		cookieSecure:        cookieSecure,
		appBaseURL:          strings.TrimRight(strings.TrimSpace(options.AppBaseURL), "/"),
		passwordResetSender: options.PasswordResetSender,
		clientIP:            clientIP,
		now:                 time.Now,
		writesDisabled:      options.WritesDisabled,
	}
}

func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input credentials
	if !decodeJSON(w, r, &input) {
		return
	}
	email, password, ok := normalizeCredentials(w, input)
	if !ok {
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		httpx.WriteInternalError(w, r, "hash registration password", err, "password hash failed")
		return
	}

	user, err := s.store.CreateUser(r.Context(), email, string(hash))
	if err != nil {
		if errors.Is(err, ErrEmailTaken) {
			writeError(w, http.StatusConflict, "email already registered")
			return
		}
		httpx.WriteInternalError(w, r, "create account", err, "account could not be created")
		return
	}
	if !s.createSession(w, r, user) {
		return
	}
	writeJSON(w, http.StatusCreated, meResponse{Authenticated: true, User: &user})
}

func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input credentials
	if !decodeJSON(w, r, &input) {
		return
	}
	email, password, ok := normalizeCredentials(w, input)
	if !ok {
		return
	}

	account, err := s.store.FindUserByEmail(r.Context(), email)
	if errors.Is(err, ErrInvalidAuth) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "find login account", err, "login failed")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(password)) != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if !s.createSession(w, r, account.User) {
		return
	}
	writeJSON(w, http.StatusOK, meResponse{Authenticated: true, User: &account.User})
}

func (s *Service) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if !strings.Contains(email, "@") {
		writeError(w, http.StatusBadRequest, "valid email is required")
		return
	}
	if s.passwordResetStore == nil || s.passwordResetSender == nil || s.appBaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, "password reset is temporarily unavailable")
		return
	}
	_, err := s.passwordResetStore.ConsumePasswordResetAttempt(r.Context(), hashToken(s.clientIP(r)), hashToken(email), s.now(), passwordResetWindow, passwordResetLimit)
	if err != nil {
		if !errors.Is(err, ErrRateLimited) {
			httpx.LogError(r, "check password reset rate limit", err)
		}
		writePasswordResetAccepted(w)
		return
	}
	if err := s.passwordResetStore.QueuePasswordResetRequest(r.Context(), email, s.now()); err != nil {
		httpx.LogError(r, "queue password reset request", err)
	}
	writePasswordResetAccepted(w)
}

func (s *Service) RunPasswordResetWorker(ctx context.Context) {
	if s == nil || s.passwordResetStore == nil || s.passwordResetSender == nil || s.appBaseURL == "" {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		processed, err := s.processPasswordResetRequest(ctx)
		if err != nil {
			slog.Error("password reset worker failed", "operation", "process password reset queue", "error", err)
		}
		if processed && err == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) processPasswordResetRequest(ctx context.Context) (bool, error) {
	now := s.now()
	request, err := s.passwordResetStore.ClaimPasswordResetRequest(ctx, now)
	if errors.Is(err, ErrNoPendingReset) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	retry := func(processErr error) (bool, error) {
		delay := time.Duration(request.Attempts) * time.Minute
		if delay > time.Hour {
			delay = time.Hour
		}
		slog.Error(
			"password reset processing failed",
			"operation", "process password reset delivery",
			"reset_request_id", request.ID,
			"attempt", request.Attempts,
			"error", processErr,
		)
		if err := s.passwordResetStore.RetryPasswordResetRequest(ctx, request.ID, now.Add(delay)); err != nil {
			slog.Error(
				"password reset retry scheduling failed",
				"operation", "schedule password reset retry",
				"reset_request_id", request.ID,
				"attempt", request.Attempts,
				"error", err,
			)
			return true, err
		}
		return true, nil
	}
	token := s.passwordResetToken(request.ID)
	if err := s.passwordResetStore.CreatePasswordResetToken(ctx, request.Email, hashToken(token), now.Add(passwordResetDuration)); errors.Is(err, ErrInvalidAuth) {
		return true, s.passwordResetStore.CompletePasswordResetRequest(ctx, request.ID, now)
	} else if err != nil {
		return retry(err)
	}
	resetURL := s.appBaseURL + "/reset-password#token=" + url.QueryEscape(token)
	idempotencyKey := "password-reset-" + request.ID
	if err := s.passwordResetSender.SendPasswordReset(ctx, request.Email, resetURL, idempotencyKey); err != nil {
		return retry(err)
	}
	return true, s.passwordResetStore.CompletePasswordResetRequest(ctx, request.ID, now)
}

func writePasswordResetAccepted(w http.ResponseWriter) {
	writeJSON(w, http.StatusAccepted, map[string]string{"message": "If an account exists for that email, a password reset link is on its way."})
}

func (s *Service) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if s.passwordResetStore == nil {
		writeError(w, http.StatusServiceUnavailable, "password reset is temporarily unavailable")
		return
	}
	if strings.TrimSpace(input.Token) == "" {
		writeError(w, http.StatusBadRequest, "reset link is invalid or has expired")
		return
	}
	if len(input.Password) < 8 || len([]byte(input.Password)) > 72 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters and no more than 72 bytes")
		return
	}
	if retryAfter, err := s.passwordResetStore.ConsumePasswordResetConfirmationAttempt(r.Context(), hashToken(s.clientIP(r)), hashToken(input.Token), s.now(), passwordConfirmWindow, passwordConfirmLimit); errors.Is(err, ErrRateLimited) {
		retrySeconds := (retryAfter + time.Second - 1) / time.Second
		if retrySeconds < 1 {
			retrySeconds = 1
		}
		w.Header().Set("Retry-After", strconv.FormatInt(int64(retrySeconds), 10))
		writeError(w, http.StatusTooManyRequests, "too many reset attempts; try again later")
		return
	} else if err != nil {
		writeError(w, http.StatusServiceUnavailable, "password reset is temporarily unavailable")
		return
	}
	valid, err := s.passwordResetStore.PasswordResetTokenValid(r.Context(), hashToken(input.Token), s.now())
	if err != nil {
		httpx.WriteInternalError(w, r, "validate password reset token", err, "password could not be reset")
		return
	}
	if !valid {
		writeError(w, http.StatusBadRequest, "reset link is invalid or has expired")
		return
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		httpx.WriteInternalError(w, r, "hash reset password", err, "password could not be reset")
		return
	}
	if err := s.passwordResetStore.ResetPassword(r.Context(), hashToken(input.Token), string(passwordHash), s.now()); errors.Is(err, ErrInvalidResetToken) {
		writeError(w, http.StatusBadRequest, "reset link is invalid or has expired")
		return
	} else if err != nil {
		httpx.WriteInternalError(w, r, "reset password", err, "password could not be reset")
		return
	}
	clearSessionCookie(w, s.cookieSecure)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if !validateSameOrigin(w, r) {
		return
	}
	if token, ok := s.readSessionToken(r); ok {
		if err := s.store.DeleteSession(r.Context(), hashToken(token)); err != nil {
			clearSessionCookie(w, s.cookieSecure)
			httpx.WriteInternalError(w, r, "delete session", err, "logout failed")
			return
		}
	}
	clearSessionCookie(w, s.cookieSecure)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := s.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusOK, meResponse{Authenticated: false})
		return
	}
	writeJSON(w, http.StatusOK, meResponse{Authenticated: true, User: &user})
}

func (s *Service) UserFromRequest(r *http.Request) (User, bool) {
	if user, ok := s.UserFromSessionRequest(r); ok {
		return user, true
	}
	return s.UserFromBearerRequest(r)
}

func (s *Service) UserFromBearerRequest(r *http.Request) (User, bool) {
	token, ok := readBearerToken(r)
	if !ok {
		return User{}, false
	}
	var user User
	var err error
	if s.writesDisabled {
		user, err = s.store.FindUserByAPITokenHashReadOnly(r.Context(), hashToken(token))
	} else {
		user, err = s.store.FindUserByAPITokenHash(r.Context(), hashToken(token), s.now())
	}
	if err != nil && !errors.Is(err, ErrUnauthorized) {
		httpx.LogError(r, "authenticate API token", err)
	}
	return user, err == nil
}

func (s *Service) UserFromSessionRequest(r *http.Request) (User, bool) {
	token, ok := s.readSessionToken(r)
	if !ok {
		return User{}, false
	}
	user, err := s.store.FindUserBySessionHash(r.Context(), hashToken(token), s.now())
	if err != nil && !errors.Is(err, ErrUnauthorized) {
		httpx.LogError(r, "authenticate session", err)
	}
	return user, err == nil
}

func (s *Service) RequireUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.UserFromRequest(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r, user)
	}
}

func (s *Service) RequireSessionUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.UserFromSessionRequest(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r, user)
	}
}

func (s *Service) ListAPITokens(w http.ResponseWriter, r *http.Request, user User) {
	tokens, err := s.store.ListAPITokens(r.Context(), user.ID)
	if err != nil {
		httpx.WriteInternalError(w, r, "list API tokens", err, "API tokens could not be loaded")
		return
	}
	if tokens == nil {
		tokens = []APIToken{}
	}
	writeJSON(w, http.StatusOK, map[string][]APIToken{"tokens": tokens})
}

func (s *Service) CreateAPIToken(w http.ResponseWriter, r *http.Request, user User) {
	if !validateAuthPost(w, r) {
		return
	}
	var input apiTokenInput
	if !decodeJSON(w, r, &input) {
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "token name is required")
		return
	}
	if len([]rune(name)) > 80 {
		writeError(w, http.StatusBadRequest, "token name must be 80 characters or fewer")
		return
	}

	plain, err := randomAPIToken()
	if err != nil {
		httpx.WriteInternalError(w, r, "generate API token", err, "API token could not be created")
		return
	}
	token, err := s.store.CreateAPIToken(r.Context(), user.ID, name, hashToken(plain))
	if err != nil {
		httpx.WriteInternalError(w, r, "store API token", err, "API token could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, createAPITokenResponse{Token: plain, APIToken: token})
}

func (s *Service) RevokeAPIToken(w http.ResponseWriter, r *http.Request, user User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "API token not found")
		return
	}
	err := s.store.RevokeAPIToken(r.Context(), user.ID, id)
	if errors.Is(err, ErrUnauthorized) {
		writeError(w, http.StatusNotFound, "API token not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "revoke API token", err, "API token could not be revoked")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) createSession(w http.ResponseWriter, r *http.Request, user User) bool {
	session, err := s.PrepareSession()
	if err != nil {
		httpx.WriteInternalError(w, r, "generate session", err, "session could not be created")
		return false
	}
	if err := s.store.CreateSession(r.Context(), user.ID, session.TokenHash, session.ExpiresAt); err != nil {
		httpx.WriteInternalError(w, r, "store session", err, "session could not be created")
		return false
	}
	s.WriteSessionCookie(w, session)
	return true
}

func (s *Service) PrepareSession() (PreparedSession, error) {
	token, err := randomToken()
	if err != nil {
		return PreparedSession{}, err
	}
	return PreparedSession{
		TokenHash:   hashToken(token),
		CookieValue: s.signToken(token),
		ExpiresAt:   s.now().Add(sessionDuration),
	}, nil
}

func (s *Service) WriteSessionCookie(w http.ResponseWriter, session PreparedSession) {
	setSessionCookie(w, session.CookieValue, session.ExpiresAt, s.cookieSecure)
}

func (s *Service) readSessionToken(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return "", false
	}
	raw, sig, ok := strings.Cut(cookie.Value, ".")
	if !ok || raw == "" || sig == "" {
		return "", false
	}
	if !hmac.Equal([]byte(sig), []byte(s.signature(raw))) {
		return "", false
	}
	return raw, true
}

func readBearerToken(r *http.Request) (string, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" {
		return "", false
	}
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" || strings.Contains(token, " ") {
		return "", false
	}
	return token, true
}

func (s *Service) signToken(token string) string {
	return token + "." + s.signature(token)
}

func (s *Service) signature(value string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func randomAPIToken() (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	return "psg_" + token, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Service) passwordResetToken(requestID string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("password-reset:" + requestID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func directClientIP(r *http.Request) string {
	host := strings.TrimSpace(r.RemoteAddr)
	if addrPort, err := netip.ParseAddrPort(host); err == nil {
		return addrPort.Addr().Unmap().String()
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Unmap().String()
	}
	return "unknown"
}

func setSessionCookie(w http.ResponseWriter, value string, expires time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type meResponse struct {
	Authenticated bool  `json:"authenticated"`
	User          *User `json:"user,omitempty"`
}

type apiTokenInput struct {
	Name string `json:"name"`
}

type createAPITokenResponse struct {
	Token    string   `json:"token"`
	APIToken APIToken `json:"apiToken"`
}

func normalizeCredentials(w http.ResponseWriter, input credentials) (string, string, bool) {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	password := input.Password
	if !strings.Contains(email, "@") {
		writeError(w, http.StatusBadRequest, "valid email is required")
		return "", "", false
	}
	if len(password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return "", "", false
	}
	return email, password, true
}

func validateAuthPost(w http.ResponseWriter, r *http.Request) bool {
	return httpx.RequireJSONMutation(w, r, httpx.SmallJSONBodyBytes)
}

func validateSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	return httpx.RequireSameOrigin(w, r)
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return false
			}
		}
	}
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return httpx.DecodeJSON(w, r, target)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
