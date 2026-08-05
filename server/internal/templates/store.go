package templates

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/passage.md/server/internal/database"
)

var ErrNotFound = errors.New("template not found")
var ErrLimitReached = errors.New("template limit reached")

const MaxTemplates = 10

type Template struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Body        string    `json:"body"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, ownerID string) ([]Template, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, title, description, body, created_at, updated_at
		FROM templates
		WHERE owner_user_id = $1
		ORDER BY updated_at DESC, id DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []Template{}
	for rows.Next() {
		var template Template
		if err := rows.Scan(&template.ID, &template.Title, &template.Description, &template.Body, &template.CreatedAt, &template.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, template)
	}
	return result, rows.Err()
}

func (s *Store) Create(ctx context.Context, ownerID string, title string, description string, body string) (Template, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Template{}, err
	}
	defer tx.Rollback(ctx)

	var lockedUserID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1 FOR UPDATE`, ownerID).Scan(&lockedUserID); err != nil {
		return Template{}, err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM templates WHERE owner_user_id = $1`, ownerID).Scan(&count); err != nil {
		return Template{}, err
	}
	if count >= MaxTemplates {
		return Template{}, ErrLimitReached
	}

	var template Template
	if err := tx.QueryRow(ctx, `
		INSERT INTO templates (owner_user_id, title, description, body)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, title, description, body, created_at, updated_at
	`, ownerID, title, description, body).Scan(&template.ID, &template.Title, &template.Description, &template.Body, &template.CreatedAt, &template.UpdatedAt); err != nil {
		return Template{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Template{}, err
	}
	return template, nil
}

func (s *Store) Get(ctx context.Context, ownerID string, id string) (Template, error) {
	if !validUUID(id) {
		return Template{}, ErrNotFound
	}
	var template Template
	err := s.db.QueryRow(ctx, `
		SELECT id::text, title, description, body, created_at, updated_at
		FROM templates
		WHERE owner_user_id = $1 AND id = $2
	`, ownerID, id).Scan(&template.ID, &template.Title, &template.Description, &template.Body, &template.CreatedAt, &template.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrNotFound
	}
	return template, err
}

func (s *Store) Update(ctx context.Context, ownerID string, id string, title string, description string, body string) (Template, error) {
	if !validUUID(id) {
		return Template{}, ErrNotFound
	}
	var template Template
	err := s.db.QueryRow(ctx, `
		UPDATE templates
		SET title = $3, description = $4, body = $5, updated_at = now()
		WHERE owner_user_id = $1 AND id = $2
		RETURNING id::text, title, description, body, created_at, updated_at
	`, ownerID, id, title, description, body).Scan(&template.ID, &template.Title, &template.Description, &template.Body, &template.CreatedAt, &template.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrNotFound
	}
	return template, err
}

func (s *Store) Delete(ctx context.Context, ownerID string, id string) error {
	if !validUUID(id) {
		return ErrNotFound
	}
	command, err := s.db.Exec(ctx, `DELETE FROM templates WHERE owner_user_id = $1 AND id = $2`, ownerID, id)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
				return false
			}
		}
	}
	return true
}
