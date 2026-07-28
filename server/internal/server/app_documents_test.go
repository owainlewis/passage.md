package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

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

func TestCreateDocReturnsPaymentRequiredAtFreeLimit(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	billingStore := newRouteBillingStore()
	billingStore.savedDocs["user-1"] = 5
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		docs:    documents.NewHandler(docStore),
		billing: billing.NewService(billingStore, routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/docs", strings.NewReader(`{"body":"# Limit"}`))
	req.Header.Set("Authorization", "Bearer psg_owner_one")
	req.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if docStore.body != "" {
		t.Fatalf("document store was called with body %q", docStore.body)
	}
}

func TestPaidOnlyRoutesReturnPaymentRequiredForFreeUsers(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	docStore := newRouteDocumentStore()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		docs:    documents.NewHandler(docStore),
		billing: billing.NewService(newRouteBillingStore(), routeBillingConfig()),
	}

	share := httptest.NewRecorder()
	shareReq := httptest.NewRequest(http.MethodPost, "/api/v1/docs/11111111-1111-1111-1111-111111111111/share", nil)
	shareReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(share, shareReq)
	if share.Code != http.StatusPaymentRequired {
		t.Fatalf("share status = %d, body = %s", share.Code, share.Body.String())
	}

	token := httptest.NewRecorder()
	tokenReq := httptest.NewRequest(http.MethodPost, "/api/v1/api-tokens", strings.NewReader(`{"name":"CLI"}`))
	tokenReq.Header.Set("Content-Type", "application/json")
	tokenReq.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(token, tokenReq)
	if token.Code != http.StatusPaymentRequired {
		t.Fatalf("token status = %d, body = %s", token.Code, token.Body.String())
	}
}

func TestBearerDocumentAPIReturnsPaymentRequiredForFreeUsers(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		docs:    documents.NewHandler(docStore),
		billing: billing.NewService(newRouteBillingStore(), routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	req.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
