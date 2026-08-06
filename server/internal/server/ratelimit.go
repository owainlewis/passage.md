package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

type fixedWindowLimiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	entries   map[string]rateLimitEntry
	now       func() time.Time
	lastSweep time.Time
	scope     string
	store     rateLimitStore
	hashKey   func(string) string
}

type rateLimitEntry struct {
	windowStarted time.Time
	requests      int
}

type appRateLimiters struct {
	authMutation     *fixedWindowLimiter
	documentMutation *fixedWindowLimiter
	documentSearch   *fixedWindowLimiter
	apiToken         *fixedWindowLimiter
	sharedHTML       *fixedWindowLimiter
	rawMarkdown      *fixedWindowLimiter
}

func newAppRateLimiters(settings config.AbuseRateLimitConfig) appRateLimiters {
	return appRateLimiters{
		authMutation:     newFixedWindowLimiter(settings.AuthMutation),
		documentMutation: newFixedWindowLimiter(settings.DocumentMutation),
		documentSearch:   newFixedWindowLimiter(settings.DocumentSearch),
		apiToken:         newFixedWindowLimiter(settings.APIToken),
		sharedHTML:       newFixedWindowLimiter(settings.SharedHTML),
		rawMarkdown:      newFixedWindowLimiter(settings.RawMarkdown),
	}
}

func newPersistentAppRateLimiters(settings config.AbuseRateLimitConfig, store rateLimitStore, secret string) appRateLimiters {
	return appRateLimiters{
		authMutation:     newPersistentFixedWindowLimiter("auth_mutation", settings.AuthMutation, store, secret),
		documentMutation: newPersistentFixedWindowLimiter("document_mutation", settings.DocumentMutation, store, secret),
		documentSearch:   newPersistentFixedWindowLimiter("document_search", settings.DocumentSearch, store, secret),
		apiToken:         newPersistentFixedWindowLimiter("api_token", settings.APIToken, store, secret),
		sharedHTML:       newPersistentFixedWindowLimiter("shared_html", settings.SharedHTML, store, secret),
		rawMarkdown:      newPersistentFixedWindowLimiter("raw_markdown", settings.RawMarkdown, store, secret),
	}
}

func newFixedWindowLimiter(settings config.RateLimitConfig) *fixedWindowLimiter {
	return &fixedWindowLimiter{
		limit:   settings.Requests,
		window:  settings.Window,
		entries: make(map[string]rateLimitEntry),
		now:     time.Now,
	}
}

func newPersistentFixedWindowLimiter(scope string, settings config.RateLimitConfig, store rateLimitStore, secret string) *fixedWindowLimiter {
	return &fixedWindowLimiter{
		limit:   settings.Requests,
		window:  settings.Window,
		now:     time.Now,
		scope:   scope,
		store:   store,
		hashKey: newRateLimitKeyHasher(secret, scope),
	}
}

func newRateLimitKeyHasher(secret string, scope string) func(string) string {
	return func(key string) string {
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte("passage-abuse-rate-limit-v1"))
		_, _ = mac.Write([]byte{0})
		_, _ = mac.Write([]byte(scope))
		_, _ = mac.Write([]byte{0})
		_, _ = mac.Write([]byte(key))
		return hex.EncodeToString(mac.Sum(nil))
	}
}

func (l *fixedWindowLimiter) allow(key string) (bool, time.Duration) {
	allowed, retryAfter, _ := l.allowContext(context.Background(), key)
	return allowed, retryAfter
}

func (l *fixedWindowLimiter) allowContext(ctx context.Context, key string) (bool, time.Duration, error) {
	if l == nil || l.limit <= 0 || l.window <= 0 {
		return true, 0, nil
	}
	now := l.now()
	if l.store != nil {
		return l.store.consume(ctx, l.scope, l.hashKey(key), now, l.window, l.limit)
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.lastSweep.IsZero() || !now.Before(l.lastSweep.Add(l.window)) {
		for existingKey, existingEntry := range l.entries {
			if !now.Before(existingEntry.windowStarted.Add(l.window)) {
				delete(l.entries, existingKey)
			}
		}
		l.lastSweep = now
	}

	entry, exists := l.entries[key]
	if !exists || !now.Before(entry.windowStarted.Add(l.window)) {
		l.entries[key] = rateLimitEntry{windowStarted: now, requests: 1}
		return true, 0, nil
	}
	if entry.requests >= l.limit {
		return false, entry.windowStarted.Add(l.window).Sub(now), nil
	}
	entry.requests++
	l.entries[key] = entry
	return true, 0, nil
}

func (a *App) limitAuthMutation(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.allowRateLimitedRequest(w, r, a.rateLimiters.authMutation, a.clientIP.Resolve(r), true) {
			return
		}
		next(w, r)
	}
}

func (a *App) limitPublicDocument(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limiter := a.rateLimiters.sharedHTML
		if strings.HasSuffix(r.PathValue("token"), ".md") {
			limiter = a.rateLimiters.rawMarkdown
		}
		if !a.allowRateLimitedRequest(w, r, limiter, a.clientIP.Resolve(r), false) {
			return
		}
		next(w, r)
	}
}

func (a *App) allowRateLimitedRequest(w http.ResponseWriter, r *http.Request, limiter *fixedWindowLimiter, key string, jsonResponse bool) bool {
	allowed, retryAfter, err := limiter.allowContext(r.Context(), key)
	if err != nil {
		httpx.LogError(r, "check abuse rate limit", err)
		w.Header().Set("Cache-Control", "no-store")
		if jsonResponse {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "rate limit service unavailable"})
		} else {
			http.Error(w, "rate limit service unavailable", http.StatusServiceUnavailable)
		}
		return false
	}
	if allowed {
		return true
	}
	retrySeconds := int64(math.Ceil(retryAfter.Seconds()))
	if retrySeconds < 1 {
		retrySeconds = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(retrySeconds, 10))
	w.Header().Set("Cache-Control", "no-store")
	if jsonResponse {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
	} else {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
	}
	return false
}

func (a *App) allowUserRequest(w http.ResponseWriter, r *http.Request, limiter *fixedWindowLimiter, userID string) bool {
	return a.allowRateLimitedRequest(w, r, limiter, userID, true)
}
