package server

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/owainlewis/passage.md/server/internal/config"
)

type fixedWindowLimiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	entries   map[string]rateLimitEntry
	now       func() time.Time
	lastSweep time.Time
}

type rateLimitEntry struct {
	windowStarted time.Time
	requests      int
}

type appRateLimiters struct {
	authMutation     *fixedWindowLimiter
	documentMutation *fixedWindowLimiter
	apiToken         *fixedWindowLimiter
	sharedHTML       *fixedWindowLimiter
	rawMarkdown      *fixedWindowLimiter
}

func newAppRateLimiters(settings config.AbuseRateLimitConfig) appRateLimiters {
	return appRateLimiters{
		authMutation:     newFixedWindowLimiter(settings.AuthMutation),
		documentMutation: newFixedWindowLimiter(settings.DocumentMutation),
		apiToken:         newFixedWindowLimiter(settings.APIToken),
		sharedHTML:       newFixedWindowLimiter(settings.SharedHTML),
		rawMarkdown:      newFixedWindowLimiter(settings.RawMarkdown),
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

func (l *fixedWindowLimiter) allow(key string) (bool, time.Duration) {
	if l == nil || l.limit <= 0 || l.window <= 0 {
		return true, 0
	}
	now := l.now()
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
		return true, 0
	}
	if entry.requests >= l.limit {
		return false, entry.windowStarted.Add(l.window).Sub(now)
	}
	entry.requests++
	l.entries[key] = entry
	return true, 0
}

func (a *App) limitAuthMutation(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.allowRateLimitedRequest(w, a.rateLimiters.authMutation, a.clientIP.Resolve(r), true) {
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
		if !a.allowRateLimitedRequest(w, limiter, a.clientIP.Resolve(r), false) {
			return
		}
		next(w, r)
	}
}

func (a *App) allowRateLimitedRequest(w http.ResponseWriter, limiter *fixedWindowLimiter, key string, jsonResponse bool) bool {
	allowed, retryAfter := limiter.allow(key)
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

func (a *App) allowUserRequest(w http.ResponseWriter, limiter *fixedWindowLimiter, userID string) bool {
	return a.allowRateLimitedRequest(w, limiter, userID, true)
}
