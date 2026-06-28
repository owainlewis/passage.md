package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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

type memoryStore struct {
	users     map[string]UserWithPassword
	sessions  map[string]User
	nextID    int
	findErr   error
	deleteErr error
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:    map[string]UserWithPassword{},
		sessions: map[string]User{},
		nextID:   1,
	}
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
