package auth

import (
	"context"
	"errors"
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
