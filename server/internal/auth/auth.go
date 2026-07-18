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
	"net/http"
	"strings"
	"time"

	"github.com/owainlewis/passage.md/server/internal/httpx"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName      = "passage_session"
	sessionDuration = 30 * 24 * time.Hour
)

var (
	ErrEmailTaken   = errors.New("email already exists")
	ErrInvalidAuth  = errors.New("invalid email or password")
	ErrUnauthorized = errors.New("unauthorized")
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
}

type Service struct {
	store        Store
	secret       []byte
	cookieSecure bool
	now          func() time.Time
}

func NewService(store Store, secret string, cookieSecure bool) *Service {
	return &Service{
		store:        store,
		secret:       []byte(secret),
		cookieSecure: cookieSecure,
		now:          time.Now,
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
		writeError(w, http.StatusInternalServerError, "password hash failed")
		return
	}

	user, err := s.store.CreateUser(r.Context(), email, string(hash))
	if err != nil {
		if errors.Is(err, ErrEmailTaken) {
			writeError(w, http.StatusConflict, "email already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "account could not be created")
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
		writeError(w, http.StatusInternalServerError, "login failed")
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

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if !validateSameOrigin(w, r) {
		return
	}
	if token, ok := s.readSessionToken(r); ok {
		if err := s.store.DeleteSession(r.Context(), hashToken(token)); err != nil {
			clearSessionCookie(w, s.cookieSecure)
			writeError(w, http.StatusInternalServerError, "logout failed")
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
	user, err := s.store.FindUserByAPITokenHash(r.Context(), hashToken(token), s.now())
	return user, err == nil
}

func (s *Service) UserFromSessionRequest(r *http.Request) (User, bool) {
	token, ok := s.readSessionToken(r)
	if !ok {
		return User{}, false
	}
	user, err := s.store.FindUserBySessionHash(r.Context(), hashToken(token), s.now())
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
		writeError(w, http.StatusInternalServerError, "API tokens could not be loaded")
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
		writeError(w, http.StatusInternalServerError, "API token could not be created")
		return
	}
	token, err := s.store.CreateAPIToken(r.Context(), user.ID, name, hashToken(plain))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "API token could not be created")
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
		writeError(w, http.StatusInternalServerError, "API token could not be revoked")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) createSession(w http.ResponseWriter, r *http.Request, user User) bool {
	session, err := s.PrepareSession()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session could not be created")
		return false
	}
	if err := s.store.CreateSession(r.Context(), user.ID, session.TokenHash, session.ExpiresAt); err != nil {
		writeError(w, http.StatusInternalServerError, "session could not be created")
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
