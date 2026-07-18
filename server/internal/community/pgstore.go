package community

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/database"
)

type PGStore struct {
	db *database.Pool
}

func NewPGStore(db *database.Pool) *PGStore {
	return &PGStore{db: db}
}

func (s *PGStore) CreateCodes(ctx context.Context, label string, hashes []string) ([]StoredCode, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	codes := make([]StoredCode, 0, len(hashes))
	for _, hash := range hashes {
		var code StoredCode
		err := tx.QueryRow(ctx, `
			INSERT INTO community_access_codes (code_hash, batch_label)
			VALUES ($1, $2)
			RETURNING id::text, code_hash, batch_label, created_at
		`, hash, label).Scan(&code.ID, &code.CodeHash, &code.BatchLabel, &code.CreatedAt)
		if err != nil {
			return nil, err
		}
		codes = append(codes, code)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return codes, nil
}

func (s *PGStore) CanRedeem(ctx context.Context, codeHash string) (bool, error) {
	var redeemable bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM community_access_codes
			WHERE code_hash = $1
			  AND disabled_at IS NULL
			  AND redeemed_user_id IS NULL
			  AND revoked_at IS NULL
		)
	`, codeHash).Scan(&redeemable)
	return redeemable, err
}

func (s *PGStore) Redeem(ctx context.Context, codeHash string, email string, passwordHash string, session auth.PreparedSession, now time.Time) (auth.User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return auth.User{}, err
	}
	defer tx.Rollback(ctx)

	var codeID string
	err = tx.QueryRow(ctx, `
		SELECT id::text
		FROM community_access_codes
		WHERE code_hash = $1
		  AND disabled_at IS NULL
		  AND redeemed_user_id IS NULL
		  AND revoked_at IS NULL
		FOR UPDATE
	`, codeHash).Scan(&codeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, ErrInvalidCode
	}
	if err != nil {
		return auth.User{}, err
	}

	var user auth.User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id::text, email
	`, email, passwordHash).Scan(&user.ID, &user.Email)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return auth.User{}, ErrEmailTaken
		}
		return auth.User{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, session.TokenHash, session.ExpiresAt); err != nil {
		return auth.User{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE community_access_codes
		SET redeemed_user_id = $1, redeemed_at = $2
		WHERE id = $3
	`, user.ID, now, codeID); err != nil {
		return auth.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.User{}, err
	}
	return user, nil
}

func (s *PGStore) Disable(ctx context.Context, id string, now time.Time) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE community_access_codes
		SET disabled_at = $2
		WHERE id = $1 AND redeemed_user_id IS NULL AND disabled_at IS NULL
	`, id, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCodeNotFound
	}
	return nil
}

func (s *PGStore) Revoke(ctx context.Context, id string, reason string, now time.Time) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE community_access_codes
		SET revoked_at = $2, revocation_reason = $3
		WHERE id = $1 AND redeemed_user_id IS NOT NULL AND revoked_at IS NULL
	`, id, now, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCodeNotRedeemed
	}
	return nil
}
