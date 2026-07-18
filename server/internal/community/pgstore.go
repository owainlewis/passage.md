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

func (s *PGStore) CreateReferral(ctx context.Context, slug string, name string, codeHash string) (StoredReferral, error) {
	var referral StoredReferral
	err := s.db.QueryRow(ctx, `
		INSERT INTO community_referrals (slug, name, code_hash)
		VALUES ($1, $2, $3)
		RETURNING id::text, slug, name, code_hash, created_at
	`, slug, name, codeHash).Scan(&referral.ID, &referral.Slug, &referral.Name, &referral.CodeHash, &referral.CreatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return StoredReferral{}, ErrReferralExists
	}
	return referral, err
}

func (s *PGStore) FindActiveReferral(ctx context.Context, slug string, codeHash string) (StoredReferral, error) {
	var referral StoredReferral
	err := s.db.QueryRow(ctx, `
		SELECT id::text, slug, name, code_hash, created_at
		FROM community_referrals
		WHERE slug = $1 AND code_hash = $2 AND disabled_at IS NULL
	`, slug, codeHash).Scan(&referral.ID, &referral.Slug, &referral.Name, &referral.CodeHash, &referral.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredReferral{}, ErrReferralNotFound
	}
	return referral, err
}

func (s *PGStore) Redeem(ctx context.Context, slug string, codeHash string, email string, passwordHash string, session auth.PreparedSession, now time.Time) (auth.User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return auth.User{}, err
	}
	defer tx.Rollback(ctx)

	var referralID string
	err = tx.QueryRow(ctx, `
		SELECT id::text FROM community_referrals
		WHERE slug = $1 AND code_hash = $2 AND disabled_at IS NULL
		FOR SHARE
	`, slug, codeHash).Scan(&referralID)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, ErrInvalidReferral
	}
	if err != nil {
		return auth.User{}, err
	}

	var user auth.User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash) VALUES ($1, $2)
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
		INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)
	`, user.ID, session.TokenHash, session.ExpiresAt); err != nil {
		return auth.User{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO community_grants (user_id, referral_id, granted_at) VALUES ($1, $2, $3)
	`, user.ID, referralID, now); err != nil {
		return auth.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.User{}, err
	}
	return user, nil
}

func (s *PGStore) RotateReferral(ctx context.Context, id string, codeHash string, now time.Time) (StoredReferral, error) {
	var referral StoredReferral
	err := s.db.QueryRow(ctx, `
		UPDATE community_referrals SET code_hash = $2, rotated_at = $3
		WHERE id = $1 AND disabled_at IS NULL
		RETURNING id::text, slug, name, code_hash, created_at
	`, id, codeHash, now).Scan(&referral.ID, &referral.Slug, &referral.Name, &referral.CodeHash, &referral.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredReferral{}, ErrReferralNotFound
	}
	return referral, err
}

func (s *PGStore) DisableReferral(ctx context.Context, id string, now time.Time) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE community_referrals SET disabled_at = $2
		WHERE id = $1 AND disabled_at IS NULL
	`, id, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrReferralNotFound
	}
	return nil
}

func (s *PGStore) RevokeGrant(ctx context.Context, email string, reason string, now time.Time) error {
	tag, err := s.db.Exec(ctx, `
		UPDATE community_grants AS grants
		SET revoked_at = $2, revocation_reason = $3
		FROM users
		WHERE grants.user_id = users.id
		  AND users.email = $1
		  AND grants.revoked_at IS NULL
	`, email, now, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrGrantNotFound
	}
	return nil
}
