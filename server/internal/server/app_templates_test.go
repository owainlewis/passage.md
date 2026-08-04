package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/owainlewis/passage.md/server/internal/auth"
	passagetemplates "github.com/owainlewis/passage.md/server/internal/templates"
)

type routeTemplateStore struct {
	ownerID string
	title   string
	body    string
}

func (s *routeTemplateStore) List(context.Context, string) ([]passagetemplates.Template, error) {
	return []passagetemplates.Template{}, nil
}

func (s *routeTemplateStore) Create(_ context.Context, ownerID string, title string, body string) (passagetemplates.Template, error) {
	s.ownerID = ownerID
	s.title = title
	s.body = body
	return passagetemplates.Template{ID: "11111111-1111-1111-1111-111111111111", Title: title, Body: body}, nil
}

func (s *routeTemplateStore) Get(context.Context, string, string) (passagetemplates.Template, error) {
	return passagetemplates.Template{}, passagetemplates.ErrNotFound
}

func (s *routeTemplateStore) Update(context.Context, string, string, string, string) (passagetemplates.Template, error) {
	return passagetemplates.Template{}, passagetemplates.ErrNotFound
}

func (s *routeTemplateStore) Delete(context.Context, string, string) error {
	return passagetemplates.ErrNotFound
}

func TestTemplateRoutesRequireBrowserSession(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	store := &routeTemplateStore{}
	app := &App{
		static:    fstest.MapFS{"index.html": {Data: []byte("ok")}},
		auth:      auth.NewService(authStore, "test-secret", false),
		templates: passagetemplates.NewHandler(store),
	}

	anonymous := httptest.NewRecorder()
	app.Routes().ServeHTTP(anonymous, httptest.NewRequest(http.MethodGet, "/api/v1/templates", nil))
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d", anonymous.Code)
	}

	bearer := httptest.NewRecorder()
	bearerRequest := httptest.NewRequest(http.MethodGet, "/api/v1/templates", nil)
	bearerRequest.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(bearer, bearerRequest)
	if bearer.Code != http.StatusUnauthorized {
		t.Fatalf("bearer status = %d", bearer.Code)
	}

	create := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(`{"title":"Video script","body":"# [Title]"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	createRequest.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(create, createRequest)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status/body = %d/%s", create.Code, create.Body.String())
	}
	if store.ownerID != "user-1" || store.title != "Video script" || store.body != "# [Title]" {
		t.Fatalf("stored owner/title/body = %q/%q/%q", store.ownerID, store.title, store.body)
	}
}
