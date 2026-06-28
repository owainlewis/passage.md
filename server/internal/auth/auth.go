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

type Store interface {
	CreateUser(ctx context.Context, email string, passwordHash string) (User, error)
	FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error)
	FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
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

func (s *Service) createSession(w http.ResponseWriter, r *http.Request, user User) bool {
	token, err := randomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session could not be created")
		return false
	}
	expires := s.now().Add(sessionDuration)
	if err := s.store.CreateSession(r.Context(), user.ID, hashToken(token), expires); err != nil {
		writeError(w, http.StatusInternalServerError, "session could not be created")
		return false
	}
	setSessionCookie(w, s.signToken(token), expires, s.cookieSecure)
	return true
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
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return false
	}
	return validateSameOrigin(w, r)
}

func validateSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	expected := scheme(r) + "://" + r.Host
	if origin != expected {
		writeError(w, http.StatusForbidden, "cross-origin auth requests are not allowed")
		return false
	}
	return true
}

func scheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" || proto == "http" {
		return proto
	}
	return "http"
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
