package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestHealthReturnsUnavailableWithoutDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"database\":\"not_configured\",\"status\":\"unavailable\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestHealthChecksDatabase(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		body   string
	}{
		{name: "available", status: http.StatusOK, body: "{\"database\":\"ok\",\"status\":\"ok\"}\n"},
		{name: "unavailable", err: errors.New("database down"), status: http.StatusServiceUnavailable, body: "{\"database\":\"unavailable\",\"status\":\"unavailable\"}\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pinger := &routeDatabasePinger{err: test.err}
			app := &App{static: fstest.MapFS{"index.html": {Data: []byte("ok")}}, databaseHealth: pinger}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			app.Routes().ServeHTTP(rec, req)
			if rec.Code != test.status || rec.Body.String() != test.body {
				t.Fatalf("status/body = %d/%q", rec.Code, rec.Body.String())
			}
			if pinger.calls != 1 {
				t.Fatalf("ping calls = %d", pinger.calls)
			}
		})
	}
}

type routeDatabasePinger struct {
	err   error
	calls int
}

func (p *routeDatabasePinger) Ping(context.Context) error {
	p.calls++
	return p.err
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
	if cacheControl := rec.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cacheControl)
	}
	if body := rec.Body.String(); body != "{\"authenticated\":false,\"policyVersion\":\"2026-07-27\",\"publicSignupEnabled\":false}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestMeAdvertisesPublicSignupWhenEnabled(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil, Options{PublicSignupEnabled: true})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"authenticated\":false,\"policyVersion\":\"2026-07-27\",\"publicSignupEnabled\":true}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestMeHidesPublicSignupWhenWritesAreDisabled(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil, Options{WritesDisabled: true, PublicSignupEnabled: true})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"authenticated\":false,\"policyVersion\":\"2026-07-27\",\"publicSignupEnabled\":false}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestWriteFenceBlocksEveryMutationRoute(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil, Options{WritesDisabled: true, PublicSignupEnabled: true})

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/auth/register"},
		{http.MethodPost, "/api/v1/auth/referral/validate"},
		{http.MethodPost, "/api/v1/auth/referral-signup"},
		{http.MethodPost, "/api/v1/auth/login"},
		{http.MethodPost, "/api/v1/auth/logout"},
		{http.MethodPost, "/api/v1/auth/password-reset/request"},
		{http.MethodPost, "/api/v1/auth/password-reset/confirm"},
		{http.MethodPatch, "/api/v1/admin/users/user@example.com/account"},
		{http.MethodPost, "/api/v1/admin/community-referrals"},
		{http.MethodPost, "/api/v1/admin/community-referrals/referral-id/rotate"},
		{http.MethodPost, "/api/v1/admin/community-referrals/referral-id/disable"},
		{http.MethodPost, "/api/v1/admin/community-grants/revoke"},
		{http.MethodPost, "/api/v1/billing/checkout"},
		{http.MethodPost, "/api/v1/billing/portal"},
		{http.MethodPost, "/api/v1/billing/webhook"},
		{http.MethodPost, "/api/v1/api-tokens"},
		{http.MethodDelete, "/api/v1/api-tokens/token-id"},
		{http.MethodPost, "/api/v1/docs"},
		{http.MethodPatch, "/api/v1/docs/document-id"},
		{http.MethodDelete, "/api/v1/docs/document-id"},
		{http.MethodPost, "/api/v1/docs/document-id/share"},
		{http.MethodDelete, "/api/v1/docs/document-id/share"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(route.method, route.path, nil)
			app.Routes().ServeHTTP(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
			}
			if body := rec.Body.String(); body != "{\"error\":\"writes are temporarily disabled for database recovery\"}\n" {
				t.Fatalf("body = %q", body)
			}
			if retryAfter := rec.Header().Get("Retry-After"); retryAfter != "60" {
				t.Fatalf("Retry-After = %q, want 60", retryAfter)
			}
			if cacheControl := rec.Header().Get("Cache-Control"); cacheControl != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", cacheControl)
			}
		})
	}
}

func TestWriteFenceKeepsReadRoutesAvailable(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil, Options{WritesDisabled: true})

	for _, path := range []string{"/", "/api/v1/me"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			app.Routes().ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}
