package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

func TestHealth(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"database\":\"not_configured\",\"status\":\"ok\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestMeReturnsAnonymousWithoutDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"authenticated\":false}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestDocsRequireDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestDocumentRoutesAcceptBearerTokensAndEnforceOwnership(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:   auth.NewService(authStore, "test-secret", false),
		docs:   documents.NewHandler(docStore),
	}

	anonymous := httptest.NewRecorder()
	anonymousReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	app.Routes().ServeHTTP(anonymous, anonymousReq)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, body = %s", anonymous.Code, anonymous.Body.String())
	}

	create := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/docs", strings.NewReader(`{"body":"# Token doc"}`))
	createReq.Header.Set("Authorization", "Bearer psg_owner_one")
	createReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(create, createReq)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	if docStore.ownerID != "user-1" {
		t.Fatalf("create owner = %q", docStore.ownerID)
	}

	list := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	listReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(list, listReq)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
	}

	get := httptest.NewRecorder()
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs/11111111-1111-1111-1111-111111111111", nil)
	getReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(get, getReq)
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", get.Code, get.Body.String())
	}

	update := httptest.NewRecorder()
	updateReq := httptest.NewRequest(http.MethodPatch, "/api/v1/docs/11111111-1111-1111-1111-111111111111", strings.NewReader(`{"body":"# Updated token doc"}`))
	updateReq.Header.Set("Authorization", "Bearer psg_owner_one")
	updateReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(update, updateReq)
	if update.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", update.Code, update.Body.String())
	}

	otherUser := httptest.NewRecorder()
	otherUserReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs/11111111-1111-1111-1111-111111111111", nil)
	otherUserReq.Header.Set("Authorization", "Bearer psg_owner_two")
	app.Routes().ServeHTTP(otherUser, otherUserReq)
	if otherUser.Code != http.StatusNotFound {
		t.Fatalf("other user status = %d, body = %s", otherUser.Code, otherUser.Body.String())
	}

	authStore.revoked[routeTokenHash("psg_owner_one")] = true
	revoked := httptest.NewRecorder()
	revokedReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	revokedReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(revoked, revokedReq)
	if revoked.Code != http.StatusUnauthorized {
		t.Fatalf("revoked status = %d, body = %s", revoked.Code, revoked.Body.String())
	}
}

func TestStaticHandlerFallsBackToIndexForClientRoutes(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html":       {Data: []byte("<main>passage</main>")},
		"_next/app.js":     {Data: []byte("console.log('ok')")},
		"nested/index.txt": {Data: []byte("nested")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/write", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>passage</main>" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerServesExportedHTMLRoute(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html":     {Data: []byte("<main>home</main>")},
		"write.html":     {Data: []byte("<main>write</main>")},
		"write/data.txt": {Data: []byte("data")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/write", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>write</main>" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerServesHeadForIndex(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<main>home</main>"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp(os.DirFS(dir), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "/", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerReturnsNotFoundForMissingAssets(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>home</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/_next/static/missing.js", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

type routeAuthStore struct {
	users   map[string]auth.User
	revoked map[string]bool
}

func newRouteAuthStore() *routeAuthStore {
	return &routeAuthStore{
		users: map[string]auth.User{
			routeTokenHash("psg_owner_one"): {ID: "user-1", Email: "one@example.com"},
			routeTokenHash("psg_owner_two"): {ID: "user-2", Email: "two@example.com"},
		},
		revoked: map[string]bool{},
	}
}

func (s *routeAuthStore) CreateUser(ctx context.Context, email string, passwordHash string) (auth.User, error) {
	return auth.User{}, errors.New("not implemented")
}

func (s *routeAuthStore) FindUserByEmail(ctx context.Context, email string) (auth.UserWithPassword, error) {
	return auth.UserWithPassword{}, auth.ErrInvalidAuth
}

func (s *routeAuthStore) FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (auth.User, error) {
	return auth.User{}, auth.ErrUnauthorized
}

func (s *routeAuthStore) CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	return errors.New("not implemented")
}

func (s *routeAuthStore) DeleteSession(ctx context.Context, tokenHash string) error {
	return nil
}

func (s *routeAuthStore) ListAPITokens(ctx context.Context, userID string) ([]auth.APIToken, error) {
	return nil, nil
}

func (s *routeAuthStore) CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (auth.APIToken, error) {
	return auth.APIToken{}, errors.New("not implemented")
}

func (s *routeAuthStore) RevokeAPIToken(ctx context.Context, userID string, id string) error {
	return auth.ErrUnauthorized
}

func (s *routeAuthStore) FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (auth.User, error) {
	if s.revoked[tokenHash] {
		return auth.User{}, auth.ErrUnauthorized
	}
	user, ok := s.users[tokenHash]
	if !ok {
		return auth.User{}, auth.ErrUnauthorized
	}
	return user, nil
}

func routeTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

type routeDocumentStore struct {
	ownerID string
	body    string
}

func newRouteDocumentStore() *routeDocumentStore {
	return &routeDocumentStore{}
}

func (s *routeDocumentStore) List(ctx context.Context, ownerID string) ([]documents.Document, error) {
	s.ownerID = ownerID
	return []documents.Document{}, nil
}

func (s *routeDocumentStore) Create(ctx context.Context, ownerID string, body string) (documents.Document, error) {
	s.ownerID = ownerID
	s.body = body
	return documents.Document{ID: "11111111-1111-1111-1111-111111111111", Title: "Token doc", Body: body}, nil
}

func (s *routeDocumentStore) Get(ctx context.Context, ownerID string, id string) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	return documents.Document{ID: id, Title: "Token doc", Body: s.body}, nil
}

func (s *routeDocumentStore) Update(ctx context.Context, ownerID string, id string, body string) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	s.body = body
	return documents.Document{ID: id, Title: "Token doc", Body: body}, nil
}

func (s *routeDocumentStore) Archive(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.ErrNotFound
	}
	return nil
}

func (s *routeDocumentStore) Share(ctx context.Context, ownerID string, id string) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	return documents.Document{ID: id, Title: "Token doc", Body: s.body, ShareToken: &token}, nil
}

func (s *routeDocumentStore) Unshare(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.ErrNotFound
	}
	return nil
}

func (s *routeDocumentStore) GetPublic(ctx context.Context, token string) (documents.Document, error) {
	return documents.Document{}, documents.ErrNotFound
}
