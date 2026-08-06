package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestPersistentRateLimitSpansInstancesAndRestarts(t *testing.T) {
	db := openRateLimitTestDatabase(t)
	defer db.Close()

	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	secret := fmt.Sprintf("rate-limit-secret-%d", time.Now().UnixNano())
	settings := config.AbuseRateLimitConfig{
		AuthMutation: config.RateLimitConfig{Requests: 2, Window: time.Minute},
	}
	options := Options{
		SessionSecret: secret,
		RateLimits:    settings,
		Proxy: config.ProxyConfig{
			TrustedCIDRs:  []string{"127.0.0.0/8"},
			ForwardedHops: 1,
		},
	}
	newInstance := func() *App {
		app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, options)
		app.rateLimiters.authMutation.now = func() time.Time { return now }
		return app
	}
	firstInstance := newInstance()
	secondInstance := newInstance()

	if status, _ := authMutationStatus(firstInstance.Routes(), "198.51.100.20"); status != http.StatusForbidden {
		t.Fatalf("first instance status = %d, want %d", status, http.StatusForbidden)
	}
	if status, _ := authMutationStatus(secondInstance.Routes(), "198.51.100.20"); status != http.StatusForbidden {
		t.Fatalf("second instance status = %d, want %d", status, http.StatusForbidden)
	}

	restartedInstance := newInstance()
	status, retryAfter := authMutationStatus(restartedInstance.Routes(), "198.51.100.20")
	if status != http.StatusTooManyRequests {
		t.Fatalf("restarted instance status = %d, want %d", status, http.StatusTooManyRequests)
	}
	if retryAfter != "60" {
		t.Fatalf("Retry-After = %q, want 60", retryAfter)
	}
	if status, _ := authMutationStatus(secondInstance.Routes(), "198.51.100.21"); status != http.StatusForbidden {
		t.Fatalf("independent forwarded client status = %d, want %d", status, http.StatusForbidden)
	}

	keyHash := newRateLimitKeyHasher(secret, "auth_mutation")("198.51.100.20")
	defer db.Exec(context.Background(), `DELETE FROM abuse_rate_limits WHERE scope = 'auth_mutation' AND key_hash = $1`, keyHash)
	var storedHash string
	var requests int
	if err := db.QueryRow(context.Background(), `
		SELECT key_hash, requests
		FROM abuse_rate_limits
		WHERE scope = 'auth_mutation' AND key_hash = $1
	`, keyHash).Scan(&storedHash, &requests); err != nil {
		t.Fatal(err)
	}
	if storedHash == "198.51.100.20" || strings.Contains(storedHash, "198.51.100.20") || len(storedHash) != 64 {
		t.Fatalf("stored key is not a privacy-safe digest: %q", storedHash)
	}
	if requests != 3 {
		t.Fatalf("stored requests = %d, want capped blocked count 3", requests)
	}
	var rawStored bool
	if err := db.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM abuse_rate_limits
			WHERE key_hash = '198.51.100.20'
				OR key_hash LIKE '%198.51.100.20%'
		)
	`).Scan(&rawStored); err != nil {
		t.Fatal(err)
	}
	if rawStored {
		t.Fatal("raw client IP was stored")
	}
}

func TestPersistentRateLimitConcurrentBoundary(t *testing.T) {
	db := openRateLimitTestDatabase(t)
	defer db.Close()

	now := time.Date(2026, time.July, 28, 13, 0, 0, 0, time.UTC)
	secret := fmt.Sprintf("concurrent-rate-limit-%d", time.Now().UnixNano())
	settings := config.RateLimitConfig{Requests: 10, Window: time.Minute}
	first := newPersistentFixedWindowLimiter("api_token", settings, newPGRateLimitStore(db), secret)
	second := newPersistentFixedWindowLimiter("api_token", settings, newPGRateLimitStore(db), secret)
	first.now = func() time.Time { return now }
	second.now = func() time.Time { return now }

	const requests = 40
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	errs := make(chan error, requests)
	var allowed atomic.Int32
	var blocked atomic.Int32
	var workers sync.WaitGroup
	workers.Add(requests)
	for i := range requests {
		limiter := first
		if i%2 == 1 {
			limiter = second
		}
		go func() {
			defer workers.Done()
			<-start
			ok, retryAfter, err := limiter.allowContext(ctx, "user-concurrent")
			if err != nil {
				errs <- err
				return
			}
			if ok {
				allowed.Add(1)
				return
			}
			if retryAfter != time.Minute {
				errs <- fmt.Errorf("retry after = %v, want %v", retryAfter, time.Minute)
				return
			}
			blocked.Add(1)
		}()
	}
	close(start)
	workers.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if got := allowed.Load(); got != 10 {
		t.Fatalf("allowed requests = %d, want 10", got)
	}
	if got := blocked.Load(); got != 30 {
		t.Fatalf("blocked requests = %d, want 30", got)
	}

	keyHash := newRateLimitKeyHasher(secret, "api_token")("user-concurrent")
	defer db.Exec(context.Background(), `DELETE FROM abuse_rate_limits WHERE scope = 'api_token' AND key_hash = $1`, keyHash)
	var storedRequests int
	if err := db.QueryRow(ctx, `
		SELECT requests
		FROM abuse_rate_limits
		WHERE scope = 'api_token' AND key_hash = $1
	`, keyHash).Scan(&storedRequests); err != nil {
		t.Fatal(err)
	}
	if storedRequests != 11 {
		t.Fatalf("stored requests = %d, want capped value 11", storedRequests)
	}
}

func TestPersistentDocumentSearchLimitUsesSupportedScope(t *testing.T) {
	db := openRateLimitTestDatabase(t)
	defer db.Close()

	now := time.Date(2026, time.August, 6, 12, 0, 0, 0, time.UTC)
	secret := fmt.Sprintf("document-search-rate-limit-%d", time.Now().UnixNano())
	limiter := newPersistentFixedWindowLimiter(
		"document_search",
		config.RateLimitConfig{Requests: 1, Window: time.Minute},
		newPGRateLimitStore(db),
		secret,
	)
	limiter.now = func() time.Time { return now }
	keyHash := newRateLimitKeyHasher(secret, "document_search")("user-1")
	defer db.Exec(context.Background(), `DELETE FROM abuse_rate_limits WHERE scope = 'document_search' AND key_hash = $1`, keyHash)

	if allowed, _, err := limiter.allowContext(context.Background(), "user-1"); err != nil || !allowed {
		t.Fatalf("first search allowed/error = %t/%v", allowed, err)
	}
	if allowed, retryAfter, err := limiter.allowContext(context.Background(), "user-1"); err != nil || allowed || retryAfter != time.Minute {
		t.Fatalf("second search allowed/retry/error = %t/%s/%v", allowed, retryAfter, err)
	}
}

func TestPersistentPublicDocumentLimitsSpanInstancesAndFormats(t *testing.T) {
	db := openRateLimitTestDatabase(t)
	defer db.Close()

	now := time.Date(2026, time.July, 28, 13, 30, 0, 0, time.UTC)
	secret := fmt.Sprintf("public-rate-limit-%d", time.Now().UnixNano())
	options := Options{
		SessionSecret: secret,
		RateLimits: config.AbuseRateLimitConfig{
			SharedHTML:  config.RateLimitConfig{Requests: 1, Window: time.Minute},
			RawMarkdown: config.RateLimitConfig{Requests: 1, Window: time.Minute},
		},
	}
	newInstance := func() *App {
		app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, options)
		app.rateLimiters.sharedHTML.now = func() time.Time { return now }
		app.rateLimiters.rawMarkdown.now = func() time.Time { return now }
		return app
	}
	first := newInstance()
	second := newInstance()

	for _, test := range []struct {
		handler http.Handler
		path    string
		want    int
	}{
		{handler: first.Routes(), path: "/d/abcdefghijklmnopqrstuv", want: http.StatusNotFound},
		{handler: second.Routes(), path: "/d/abcdefghijklmnopqrstuv", want: http.StatusTooManyRequests},
		{handler: first.Routes(), path: "/d/abcdefghijklmnopqrstuv.md", want: http.StatusNotFound},
		{handler: second.Routes(), path: "/d/abcdefghijklmnopqrstuv.md", want: http.StatusTooManyRequests},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		request.RemoteAddr = "192.0.2.55:1234"
		test.handler.ServeHTTP(recorder, request)
		if recorder.Code != test.want {
			t.Fatalf("%s status = %d, want %d", test.path, recorder.Code, test.want)
		}
		if test.want == http.StatusTooManyRequests && recorder.Header().Get("Retry-After") != "60" {
			t.Fatalf("%s Retry-After = %q, want 60", test.path, recorder.Header().Get("Retry-After"))
		}
	}

	for _, scope := range []string{"shared_html", "raw_markdown"} {
		keyHash := newRateLimitKeyHasher(secret, scope)("192.0.2.55")
		defer db.Exec(context.Background(), `DELETE FROM abuse_rate_limits WHERE scope = $1 AND key_hash = $2`, scope, keyHash)
		var requests int
		if err := db.QueryRow(context.Background(), `
			SELECT requests
			FROM abuse_rate_limits
			WHERE scope = $1 AND key_hash = $2
		`, scope, keyHash).Scan(&requests); err != nil {
			t.Fatal(err)
		}
		if requests != 2 {
			t.Fatalf("%s requests = %d, want 2", scope, requests)
		}
	}
	var tokenStored bool
	if err := db.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM abuse_rate_limits
			WHERE key_hash LIKE '%abcdefghijklmnopqrstuv%'
		)
	`).Scan(&tokenStored); err != nil {
		t.Fatal(err)
	}
	if tokenStored {
		t.Fatal("public document token was stored in a rate limit key")
	}
}

func TestPersistentRateLimitExpiresAndCleansInBatches(t *testing.T) {
	db := openRateLimitTestDatabase(t)
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.Exec(ctx, `DELETE FROM abuse_rate_limits WHERE expires_at <= now()`); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, time.July, 28, 14, 0, 0, 0, time.UTC)
	secret := fmt.Sprintf("expiry-rate-limit-%d", time.Now().UnixNano())
	settings := config.RateLimitConfig{Requests: 1, Window: time.Minute}
	limiter := newPersistentFixedWindowLimiter("raw_markdown", settings, newPGRateLimitStore(db), secret)
	limiter.now = func() time.Time { return now }
	if allowed, _, err := limiter.allowContext(ctx, "198.51.100.30"); err != nil || !allowed {
		t.Fatalf("first request allowed = %v, error = %v", allowed, err)
	}

	restarted := newPersistentFixedWindowLimiter("raw_markdown", settings, newPGRateLimitStore(db), secret)
	restarted.now = func() time.Time { return now.Add(time.Minute) }
	if allowed, _, err := restarted.allowContext(ctx, "198.51.100.30"); err != nil || !allowed {
		t.Fatalf("request after expiry allowed = %v, error = %v", allowed, err)
	}
	keyHash := newRateLimitKeyHasher(secret, "raw_markdown")("198.51.100.30")
	defer db.Exec(context.Background(), `DELETE FROM abuse_rate_limits WHERE scope = 'raw_markdown' AND key_hash = $1`, keyHash)
	var requests int
	var started time.Time
	if err := db.QueryRow(ctx, `
		SELECT requests, window_started_at
		FROM abuse_rate_limits
		WHERE scope = 'raw_markdown' AND key_hash = $1
	`, keyHash).Scan(&requests, &started); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || !started.Equal(now.Add(time.Minute)) {
		t.Fatalf("reset row requests = %d, started = %v", requests, started)
	}

	cleanupPrefix := fmt.Sprintf("cleanup-%d", time.Now().UnixNano())
	if _, err := db.Exec(ctx, `
		INSERT INTO abuse_rate_limits (
			scope,
			key_hash,
			window_started_at,
			expires_at,
			requests
		)
		SELECT
			'shared_html',
			md5($1 || value::text) || md5($1 || ':second:' || value::text),
			$2::timestamptz - interval '2 minutes',
			$2::timestamptz - interval '1 minute',
			1
		FROM generate_series(1, 125) AS value
	`, cleanupPrefix, now); err != nil {
		t.Fatal(err)
	}
	store := newPGRateLimitStore(db)
	firstCleanupHash := newRateLimitKeyHasher(secret, "shared_html")("cleanup-trigger-one")
	secondCleanupHash := newRateLimitKeyHasher(secret, "shared_html")("cleanup-trigger-two")
	defer db.Exec(context.Background(), `
		DELETE FROM abuse_rate_limits
		WHERE scope = 'shared_html' AND key_hash = ANY($1)
	`, []string{firstCleanupHash, secondCleanupHash})
	if allowed, _, err := store.consume(ctx, "shared_html", firstCleanupHash, now, time.Minute, 10); err != nil || !allowed {
		t.Fatalf("first cleanup trigger allowed = %v, error = %v", allowed, err)
	}
	var expired int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM abuse_rate_limits WHERE expires_at <= $1`, now).Scan(&expired); err != nil {
		t.Fatal(err)
	}
	if expired != 25 {
		t.Fatalf("expired rows after full cleanup batch = %d, want 25", expired)
	}
	if allowed, _, err := store.consume(ctx, "shared_html", secondCleanupHash, now, time.Minute, 10); err != nil || !allowed {
		t.Fatalf("second cleanup trigger allowed = %v, error = %v", allowed, err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM abuse_rate_limits WHERE expires_at <= $1`, now).Scan(&expired); err != nil {
		t.Fatal(err)
	}
	if expired != 0 {
		t.Fatalf("expired rows after bounded cleanup = %d, want 0", expired)
	}
}

func TestWriteFenceKeepsRateLimitedReadsDatabaseReadOnly(t *testing.T) {
	db := openRateLimitTestDatabase(t)
	defer db.Close()

	secret := fmt.Sprintf("write-fence-rate-limit-%d", time.Now().UnixNano())
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{
		SessionSecret:  secret,
		WritesDisabled: true,
		RateLimits: config.AbuseRateLimitConfig{
			SharedHTML:     config.RateLimitConfig{Requests: 1, Window: time.Minute},
			DocumentSearch: config.RateLimitConfig{Requests: 1, Window: time.Minute},
		},
	})
	if app.rateLimiters.documentSearch.store != nil {
		t.Fatal("write-fenced document search limiter uses persistent storage")
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/d/abcdefghijklmnopqrstuv", nil)
	request.RemoteAddr = "192.0.2.44:1234"
	app.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("public read status = %d, want %d", recorder.Code, http.StatusNotFound)
	}

	keyHash := newRateLimitKeyHasher(secret, "shared_html")("192.0.2.44")
	var stored bool
	if err := db.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM abuse_rate_limits
			WHERE scope = 'shared_html' AND key_hash = $1
		)
	`, keyHash).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored {
		t.Fatal("write-fenced public read persisted a rate limit counter")
	}
}

func authMutationStatus(handler http.Handler, forwardedIP string) (int, string) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", nil)
	request.RemoteAddr = "127.0.0.1:8080"
	request.Header.Set("X-Forwarded-For", forwardedIP)
	handler.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Header().Get("Retry-After")
}

func openRateLimitTestDatabase(t *testing.T) *database.Pool {
	t.Helper()
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := migrations.Apply(ctx, db); err != nil {
		db.Close()
		t.Fatal(err)
	}
	return db
}
