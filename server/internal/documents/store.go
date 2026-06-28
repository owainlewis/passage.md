package documents

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/passage.md/server/internal/database"
)

var ErrNotFound = errors.New("document not found")

type Document struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, ownerID string) ([]Document, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, title, body, created_at, updated_at, archived_at
		FROM documents
		WHERE owner_user_id = $1
		  AND archived_at IS NULL
		ORDER BY updated_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		doc, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		docs = append(docs, doc)
	}
	return docs, rows.Err()
}

func (s *Store) Create(ctx context.Context, ownerID string, body string) (Document, error) {
	var doc Document
	err := s.db.QueryRow(ctx, `
		INSERT INTO documents (owner_user_id, title, body)
		VALUES ($1, $2, $3)
		RETURNING id::text, title, body, created_at, updated_at, archived_at
	`, ownerID, titleOf(body), body).Scan(&doc.ID, &doc.Title, &doc.Body, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	return doc, err
}

func (s *Store) Get(ctx context.Context, ownerID string, id string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	var doc Document
	err := s.db.QueryRow(ctx, `
		SELECT id::text, title, body, created_at, updated_at, archived_at
		FROM documents
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
	`, ownerID, id).Scan(&doc.ID, &doc.Title, &doc.Body, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

func (s *Store) Update(ctx context.Context, ownerID string, id string, body string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	var doc Document
	err := s.db.QueryRow(ctx, `
		UPDATE documents
		SET title = $3,
		    body = $4,
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		RETURNING id::text, title, body, created_at, updated_at, archived_at
	`, ownerID, id, titleOf(body), body).Scan(&doc.ID, &doc.Title, &doc.Body, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

func (s *Store) Archive(ctx context.Context, ownerID string, id string) error {
	if !validUUID(id) {
		return ErrNotFound
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE documents
		SET archived_at = now(),
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
	`, ownerID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanDocument(row scanner) (Document, error) {
	var doc Document
	err := row.Scan(&doc.ID, &doc.Title, &doc.Body, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	return doc, err
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return false
			}
		}
	}
	return true
}

func titleOf(body string) string {
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		line = strings.TrimLeft(line, "#")
		line = strings.TrimSpace(line)
		line = strings.Trim(line, "*_`>")
		if line != "" {
			runes := []rune(line)
			if len(runes) > 120 {
				return string(runes[:120])
			}
			return line
		}
	}
	return "Untitled"
}
