package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/owainlewis/passage.md/server/internal/database"
)

type PGStore struct {
	db *database.Pool
}

func NewPGStore(db *database.Pool) *PGStore {
	return &PGStore{db: db}
}

func (s *PGStore) CreateUser(ctx context.Context, email string, passwordHash string) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id::text, email
	`, email, passwordHash).Scan(&user.ID, &user.Email)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	return user, nil
}

func (s *PGStore) FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error) {
	var user UserWithPassword
	err := s.db.QueryRow(ctx, `
		SELECT id::text, email, password_hash
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserWithPassword{}, ErrInvalidAuth
	}
	return user, err
}

func (s *PGStore) FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		SELECT users.id::text, users.email
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1
		  AND sessions.expires_at > $2
	`, tokenHash, now).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	return user, err
}

func (s *PGStore) CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHash, expiresAt)
	return err
}

func (s *PGStore) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

func (s *PGStore) ListAPITokens(ctx context.Context, userID string) ([]APIToken, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, name, last_used_at, created_at
		FROM api_tokens
		WHERE user_id = $1
		  AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []APIToken
	for rows.Next() {
		var token APIToken
		if err := rows.Scan(&token.ID, &token.Name, &token.LastUsedAt, &token.CreatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

func (s *PGStore) CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error) {
	var token APIToken
	err := s.db.QueryRow(ctx, `
		INSERT INTO api_tokens (user_id, name, token_hash)
		VALUES ($1, $2, $3)
		RETURNING id::text, name, last_used_at, created_at
	`, userID, name, tokenHash).Scan(&token.ID, &token.Name, &token.LastUsedAt, &token.CreatedAt)
	return token, err
}

func (s *PGStore) RevokeAPIToken(ctx context.Context, userID string, id string) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE api_tokens
		SET revoked_at = now(),
		    updated_at = now()
		WHERE user_id = $1
		  AND id = $2
		  AND revoked_at IS NULL
	`, userID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUnauthorized
	}
	return nil
}

func (s *PGStore) FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		UPDATE api_tokens
		SET last_used_at = $2,
		    updated_at = $2
		FROM users
		WHERE api_tokens.user_id = users.id
		  AND api_tokens.token_hash = $1
		  AND api_tokens.revoked_at IS NULL
		RETURNING users.id::text, users.email
	`, tokenHash, now).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	return user, err
}

func (s *PGStore) FindUserByAPITokenHashReadOnly(ctx context.Context, tokenHash string) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		SELECT users.id::text, users.email
		FROM api_tokens
		JOIN users ON users.id = api_tokens.user_id
		WHERE api_tokens.token_hash = $1
		  AND api_tokens.revoked_at IS NULL
	`, tokenHash).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	return user, err
}

func (s *PGStore) ConsumePasswordResetAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	return s.consumePasswordResetRateLimit(ctx, "password_reset_rate_limits", []rateLimitKey{{"ip", ipHash}, {"email", emailHash}}, now, window, limit)
}

func (s *PGStore) ConsumePasswordResetConfirmationAttempt(ctx context.Context, ipHash string, tokenHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	return s.consumePasswordResetRateLimit(ctx, "password_reset_confirmation_rate_limits", []rateLimitKey{{"ip", ipHash}, {"token", tokenHash}}, now, window, limit)
}

type rateLimitKey struct {
	dimension string
	hash      string
}

func (s *PGStore) consumePasswordResetRateLimit(ctx context.Context, table string, keys []rateLimitKey, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	if table != "password_reset_rate_limits" && table != "password_reset_confirmation_rate_limits" {
		return 0, fmt.Errorf("unsupported rate limit table")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE window_started_at < ($1::timestamptz - interval '24 hours')", now); err != nil {
		return 0, err
	}
	retryAfter := time.Duration(0)
	for _, key := range keys {
		var attempts int
		var started time.Time
		query := `
			INSERT INTO ` + table + ` (dimension, key_hash, window_started_at, attempts)
			VALUES ($1, $2, $3, 1)
			ON CONFLICT (dimension, key_hash) DO UPDATE SET
				window_started_at = CASE
					WHEN ` + table + `.window_started_at <= $3 - $4::interval THEN $3
					ELSE ` + table + `.window_started_at
				END,
				attempts = CASE
					WHEN ` + table + `.window_started_at <= $3 - $4::interval THEN 1
					ELSE ` + table + `.attempts + 1
				END
			RETURNING attempts, window_started_at
		`
		if err := tx.QueryRow(ctx, query, key.dimension, key.hash, now, fmt.Sprintf("%f seconds", window.Seconds())).Scan(&attempts, &started); err != nil {
			return 0, err
		}
		if attempts > limit {
			remaining := window - now.Sub(started)
			if remaining > retryAfter {
				retryAfter = remaining
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	if retryAfter > 0 {
		return retryAfter, ErrRateLimited
	}
	return 0, nil
}

func (s *PGStore) QueuePasswordResetRequest(ctx context.Context, email string, now time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO password_reset_requests (email, available_at)
		VALUES ($1, $2)
	`, email, now)
	return err
}

func (s *PGStore) ClaimPasswordResetRequest(ctx context.Context, now time.Time) (PasswordResetRequest, error) {
	var request PasswordResetRequest
	err := s.db.QueryRow(ctx, `
		WITH next_request AS (
			SELECT id
			FROM password_reset_requests
			WHERE processed_at IS NULL
				AND available_at <= $1
				AND (claimed_at IS NULL OR claimed_at < $1 - interval '5 minutes')
			ORDER BY available_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE password_reset_requests r
		SET claimed_at = $1, attempts = attempts + 1
		FROM next_request
		WHERE r.id = next_request.id
		RETURNING r.id::text, r.email, r.attempts
	`, now).Scan(&request.ID, &request.Email, &request.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordResetRequest{}, ErrNoPendingReset
	}
	return request, err
}

func (s *PGStore) CompletePasswordResetRequest(ctx context.Context, id string, now time.Time) error {
	_, err := s.db.Exec(ctx, `
		UPDATE password_reset_requests
		SET processed_at = $2, claimed_at = NULL
		WHERE id = $1 AND processed_at IS NULL
	`, id, now)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `DELETE FROM password_reset_requests WHERE processed_at < $1::timestamptz - interval '24 hours'`, now)
	return err
}

func (s *PGStore) RetryPasswordResetRequest(ctx context.Context, id string, availableAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		UPDATE password_reset_requests
		SET claimed_at = NULL,
			available_at = $2,
			processed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
		WHERE id = $1 AND processed_at IS NULL
	`, id, availableAt)
	return err
}

func (s *PGStore) CreatePasswordResetToken(ctx context.Context, email string, tokenHash string, expiresAt time.Time) error {
	// Token hashes are deterministic across delivery retries, so rows remain as
	// tombstones until account deletion to prevent reviving a used credential.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var userID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE email = $1 FOR UPDATE`, email).Scan(&userID); errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidAuth
	} else if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (token_hash) DO NOTHING
	`, userID, tokenHash, expiresAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var valid bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM password_reset_tokens
				WHERE token_hash = $1
				  AND user_id = $2
				  AND used_at IS NULL
				  AND expires_at > now()
			)
		`, tokenHash, userID).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return ErrInvalidResetToken
		}
	}
	return tx.Commit(ctx)
}

func (s *PGStore) PasswordResetTokenValid(ctx context.Context, tokenHash string, now time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM password_reset_tokens
			WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
		)
	`, tokenHash, now).Scan(&valid)
	return valid, err
}

func (s *PGStore) ResetPassword(ctx context.Context, tokenHash string, passwordHash string, now time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var userID string
	if err := tx.QueryRow(ctx, `
		UPDATE password_reset_tokens
		SET used_at = $2
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
		RETURNING user_id::text
	`, tokenHash, now).Scan(&userID); errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidResetToken
	} else if err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1`, userID, passwordHash, now)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrInvalidResetToken
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE password_reset_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`, userID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
