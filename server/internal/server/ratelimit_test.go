package server

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/documents"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

type errorRateLimitStore struct {
	err error
}

func (s errorRateLimitStore) consume(context.Context, string, string, time.Time, time.Duration, int) (bool, time.Duration, error) {
	return false, 0, s.err
}

func TestFixedWindowLimiterAllowsBlocksResetsAndSeparatesKeys(t *testing.T) {
	now := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	limiter := newFixedWindowLimiter(config.RateLimitConfig{Requests: 2, Window: time.Minute})
	limiter.now = func() time.Time { return now }

	if allowed, _ := limiter.allow("user-1"); !allowed {
		t.Fatal("first request was blocked")
	}
	if allowed, _ := limiter.allow("user-1"); !allowed {
		t.Fatal("second request was blocked")
	}
	if allowed, retry := limiter.allow("user-1"); allowed || retry != time.Minute {
		t.Fatalf("third request = allowed %v, retry %v", allowed, retry)
	}
	if allowed, _ := limiter.allow("user-2"); !allowed {
		t.Fatal("independent key was blocked")
	}

	now = now.Add(time.Minute)
	if allowed, _ := limiter.allow("user-1"); !allowed {
		t.Fatal("request after window reset was blocked")
	}
}

func TestPersistentRateLimitKeysAreScopedAndPrivacySafe(t *testing.T) {
	authHash := newRateLimitKeyHasher("secret-one", "auth_mutation")("198.51.100.20")
	if len(authHash) != 64 || authHash == "198.51.100.20" || strings.Contains(authHash, "198.51.100.20") {
		t.Fatalf("auth hash = %q", authHash)
	}
	if repeated := newRateLimitKeyHasher("secret-one", "auth_mutation")("198.51.100.20"); repeated != authHash {
		t.Fatalf("repeated hash = %q, want %q", repeated, authHash)
	}
	if otherScope := newRateLimitKeyHasher("secret-one", "shared_html")("198.51.100.20"); otherScope == authHash {
		t.Fatal("different scopes produced the same hash")
	}
	if otherSecret := newRateLimitKeyHasher("secret-two", "auth_mutation")("198.51.100.20"); otherSecret == authHash {
		t.Fatal("different secrets produced the same hash")
	}
}

func TestRateLimitStoreFailureFailsClosed(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	limiter := newPersistentFixedWindowLimiter(
		"auth_mutation",
		config.RateLimitConfig{Requests: 1, Window: time.Minute},
		errorRateLimitStore{err: errors.New("database unavailable")},
		"test-secret",
	)
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("ok")}},
		rateLimiters: appRateLimiters{
			authMutation: limiter,
		},
		clientIP: httpx.NewClientIPResolver(nil, 0),
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", nil)
	request.RemoteAddr = "192.0.2.10:1234"
	app.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	if body := recorder.Body.String(); body != "{\"error\":\"rate limit service unavailable\"}\n" {
		t.Fatalf("body = %q", body)
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cacheControl)
	}
	logged := output.String()
	if !strings.Contains(logged, `"operation":"check abuse rate limit"`) || !strings.Contains(logged, `"error":"database unavailable"`) {
		t.Fatalf("log = %s", logged)
	}
	if strings.Contains(logged, "192.0.2.10") {
		t.Fatalf("log contains raw client IP: %s", logged)
	}
}

func TestAuthRouteReturnsJSONRateLimitResponse(t *testing.T) {
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, nil, Options{
		RateLimits: config.AbuseRateLimitConfig{
			AuthMutation: config.RateLimitConfig{Requests: 1, Window: time.Minute},
		},
	})
	handler := app.Routes()

	first := httptest.NewRecorder()
	firstRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", nil)
	firstRequest.RemoteAddr = "192.0.2.10:1234"
	handler.ServeHTTP(first, firstRequest)
	if first.Code != http.StatusForbidden {
		t.Fatalf("first status = %d", first.Code)
	}

	blocked := httptest.NewRecorder()
	blockedRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", nil)
	blockedRequest.RemoteAddr = "192.0.2.10:5678"
	handler.ServeHTTP(blocked, blockedRequest)
	if blocked.Code != http.StatusTooManyRequests {
		t.Fatalf("blocked status = %d", blocked.Code)
	}
	if blocked.Header().Get("Retry-After") == "" {
		t.Fatal("Retry-After is empty")
	}
	if contentType := blocked.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q", contentType)
	}
	if body := blocked.Body.String(); body != "{\"error\":\"rate limit exceeded\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestDocumentMutationLimitIsPerAuthenticatedUser(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("ok")}},
		auth:   auth.NewService(authStore, "test-secret", false),
		docs:   documents.NewHandler(docStore, nil),
		rateLimiters: newAppRateLimiters(config.AbuseRateLimitConfig{
			DocumentMutation: config.RateLimitConfig{Requests: 1, Window: time.Minute},
		}),
		clientIP: httpx.NewClientIPResolver(nil, 0),
	}
	handler := app.Routes()

	if status := documentCreateStatus(t, handler, "psg_owner_one"); status != http.StatusCreated {
		t.Fatalf("first user status = %d", status)
	}
	if status := documentCreateStatus(t, handler, "psg_owner_one"); status != http.StatusTooManyRequests {
		t.Fatalf("blocked user status = %d", status)
	}
	if status := documentCreateStatus(t, handler, "psg_owner_two"); status != http.StatusCreated {
		t.Fatalf("independent user status = %d", status)
	}
}

func TestDocumentSearchLimitIsPerAuthenticatedUserAndIndependentFromMutations(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("ok")}},
		auth:   auth.NewService(authStore, "test-secret", false),
		docs:   documents.NewHandler(docStore, nil),
		rateLimiters: newAppRateLimiters(config.AbuseRateLimitConfig{
			DocumentMutation: config.RateLimitConfig{Requests: 1, Window: time.Minute},
			DocumentSearch:   config.RateLimitConfig{Requests: 1, Window: time.Minute},
		}),
		clientIP: httpx.NewClientIPResolver(nil, 0),
	}
	handler := app.Routes()

	if status := documentSearchStatus(t, handler, "psg_owner_one"); status != http.StatusOK {
		t.Fatalf("first user status = %d", status)
	}
	if status := documentSearchStatus(t, handler, "psg_owner_one"); status != http.StatusTooManyRequests {
		t.Fatalf("blocked user status = %d", status)
	}
	if status := documentSearchStatus(t, handler, "psg_owner_two"); status != http.StatusOK {
		t.Fatalf("independent user status = %d", status)
	}
	if status := documentCreateStatus(t, handler, "psg_owner_one"); status != http.StatusCreated {
		t.Fatalf("independent mutation status = %d", status)
	}
}

func TestAPITokenLimitAppliesToRepresentativeRoute(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("ok")}},
		auth:   auth.NewService(authStore, "test-secret", false),
		rateLimiters: newAppRateLimiters(config.AbuseRateLimitConfig{
			APIToken: config.RateLimitConfig{Requests: 1, Window: time.Minute},
		}),
		clientIP: httpx.NewClientIPResolver(nil, 0),
	}
	handler := app.Routes()

	for attempt, want := range []int{http.StatusOK, http.StatusTooManyRequests} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/v1/api-tokens", nil)
		request.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
		handler.ServeHTTP(recorder, request)
		if recorder.Code != want {
			t.Fatalf("attempt %d status = %d, want %d", attempt+1, recorder.Code, want)
		}
	}
}

func TestSharedHTMLAndRawMarkdownHaveIndependentIPLimits(t *testing.T) {
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("ok")}},
		docs:   documents.NewHandler(newRouteDocumentStore(), nil),
		rateLimiters: newAppRateLimiters(config.AbuseRateLimitConfig{
			SharedHTML:  config.RateLimitConfig{Requests: 1, Window: time.Minute},
			RawMarkdown: config.RateLimitConfig{Requests: 1, Window: time.Minute},
		}),
		clientIP: httpx.NewClientIPResolver(nil, 0),
	}
	handler := app.Routes()

	for _, test := range []struct {
		path string
		want int
	}{
		{path: "/d/abcdefghijklmnopqrstuv", want: http.StatusNotFound},
		{path: "/d/abcdefghijklmnopqrstuv", want: http.StatusTooManyRequests},
		{path: "/d/abcdefghijklmnopqrstuv.md", want: http.StatusNotFound},
		{path: "/d/abcdefghijklmnopqrstuv.md", want: http.StatusTooManyRequests},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		request.RemoteAddr = "192.0.2.10:1234"
		handler.ServeHTTP(recorder, request)
		if recorder.Code != test.want {
			t.Fatalf("%s status = %d, want %d", test.path, recorder.Code, test.want)
		}
		if test.want == http.StatusTooManyRequests && recorder.Header().Get("Retry-After") == "" {
			t.Fatalf("%s Retry-After is empty", test.path)
		}
	}
}

func documentCreateStatus(t *testing.T, handler http.Handler, token string) int {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/docs", strings.NewReader(`{"body":"# Limited"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func documentSearchStatus(t *testing.T, handler http.Handler, token string) int {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/docs/search?q=limited", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}
