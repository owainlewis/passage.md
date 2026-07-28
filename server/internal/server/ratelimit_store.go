package server

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
)

const (
	rateLimitCleanupBatchSize = 100
	rateLimitCleanupInterval  = time.Minute
)

type rateLimitStore interface {
	consume(context.Context, string, string, time.Time, time.Duration, int) (bool, time.Duration, error)
}

type pgRateLimitStore struct {
	db *database.Pool

	cleanupMu   sync.Mutex
	lastCleanup time.Time
}

func newPGRateLimitStore(db *database.Pool) *pgRateLimitStore {
	return &pgRateLimitStore{db: db}
}

func (s *pgRateLimitStore) consume(ctx context.Context, scope string, keyHash string, now time.Time, window time.Duration, limit int) (bool, time.Duration, error) {
	if s == nil || s.db == nil {
		return false, 0, fmt.Errorf("rate limit store is not configured")
	}
	if err := s.maybeCleanup(ctx, now); err != nil {
		return false, 0, fmt.Errorf("clean expired rate limits: %w", err)
	}

	expiresAt := now.Add(window)
	var requests int
	var storedExpiry time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO abuse_rate_limits (
			scope,
			key_hash,
			window_started_at,
			expires_at,
			requests
		)
		VALUES ($1, $2, $3, $4, 1)
		ON CONFLICT (scope, key_hash) DO UPDATE SET
			window_started_at = CASE
				WHEN abuse_rate_limits.expires_at <= $3 THEN $3
				ELSE abuse_rate_limits.window_started_at
			END,
			expires_at = CASE
				WHEN abuse_rate_limits.expires_at <= $3 THEN $4
				ELSE abuse_rate_limits.expires_at
			END,
			requests = CASE
				WHEN abuse_rate_limits.expires_at <= $3 THEN 1
				ELSE LEAST(abuse_rate_limits.requests + 1, $5 + 1)
			END
		RETURNING requests, expires_at
	`, scope, keyHash, now, expiresAt, limit).Scan(&requests, &storedExpiry)
	if err != nil {
		return false, 0, err
	}
	if requests <= limit {
		return true, 0, nil
	}
	retryAfter := storedExpiry.Sub(now)
	if retryAfter < 0 {
		retryAfter = 0
	}
	return false, retryAfter, nil
}

func (s *pgRateLimitStore) maybeCleanup(ctx context.Context, now time.Time) error {
	s.cleanupMu.Lock()
	if !s.lastCleanup.IsZero() && now.Before(s.lastCleanup.Add(rateLimitCleanupInterval)) {
		s.cleanupMu.Unlock()
		return nil
	}
	s.lastCleanup = now
	s.cleanupMu.Unlock()

	deleted, err := s.cleanupExpired(ctx, now)
	if err != nil {
		s.cleanupMu.Lock()
		if s.lastCleanup.Equal(now) {
			s.lastCleanup = time.Time{}
		}
		s.cleanupMu.Unlock()
		return err
	}
	if deleted == rateLimitCleanupBatchSize {
		s.cleanupMu.Lock()
		if s.lastCleanup.Equal(now) {
			s.lastCleanup = time.Time{}
		}
		s.cleanupMu.Unlock()
	}
	return nil
}

func (s *pgRateLimitStore) cleanupExpired(ctx context.Context, now time.Time) (int64, error) {
	result, err := s.db.Exec(ctx, `
		WITH expired AS (
			SELECT scope, key_hash
			FROM abuse_rate_limits
			WHERE expires_at <= $1
			ORDER BY expires_at
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		DELETE FROM abuse_rate_limits limits
		USING expired
		WHERE limits.scope = expired.scope
			AND limits.key_hash = expired.key_hash
	`, now, rateLimitCleanupBatchSize)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
