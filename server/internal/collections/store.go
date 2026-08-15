package collections

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/passage.md/server/internal/database"
)

var ErrNotFound = errors.New("collection not found")
var ErrLimitReached = errors.New("collection limit reached")

const MaxCollections = 100

type Collection struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description *string   `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, ownerID string) ([]Collection, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, slug, title, description, created_at, updated_at
		FROM collections
		WHERE owner_user_id = $1
		ORDER BY created_at, id
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []Collection{}
	for rows.Next() {
		collection, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, collection)
	}
	return result, rows.Err()
}

func (s *Store) Create(ctx context.Context, ownerID string, title string, description *string) (Collection, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Collection{}, err
	}
	defer tx.Rollback(ctx)

	var lockedUserID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1 FOR UPDATE`, ownerID).Scan(&lockedUserID); err != nil {
		return Collection{}, err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM collections WHERE owner_user_id = $1`, ownerID).Scan(&count); err != nil {
		return Collection{}, err
	}
	if count >= MaxCollections {
		return Collection{}, ErrLimitReached
	}

	base := slugify(title)
	slug := base
	for suffix := 2; ; suffix++ {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM collections WHERE owner_user_id = $1 AND slug = $2)`, ownerID, slug).Scan(&exists); err != nil {
			return Collection{}, err
		}
		if !exists {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, suffix)
	}

	var collection Collection
	err = tx.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title, description)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, slug, title, description, created_at, updated_at
	`, ownerID, slug, title, description).Scan(
		&collection.ID,
		&collection.Slug,
		&collection.Title,
		&collection.Description,
		&collection.CreatedAt,
		&collection.UpdatedAt,
	)
	if err != nil {
		return Collection{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Collection{}, err
	}
	return collection, nil
}

func (s *Store) Update(ctx context.Context, ownerID string, slug string, title string, description *string) (Collection, error) {
	var collection Collection
	err := s.db.QueryRow(ctx, `
		UPDATE collections
		SET title = $3, description = $4, updated_at = now()
		WHERE owner_user_id = $1 AND slug = $2
		RETURNING id::text, slug, title, description, created_at, updated_at
	`, ownerID, slug, title, description).Scan(
		&collection.ID,
		&collection.Slug,
		&collection.Title,
		&collection.Description,
		&collection.CreatedAt,
		&collection.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Collection{}, ErrNotFound
	}
	return collection, err
}

func (s *Store) Delete(ctx context.Context, ownerID string, slug string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var collectionID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text
		FROM collections
		WHERE owner_user_id = $1 AND slug = $2
		FOR UPDATE
	`, ownerID, slug).Scan(&collectionID); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE documents
		SET collection_id = NULL, updated_at = now()
		WHERE owner_user_id = $1 AND collection_id = $2
	`, ownerID, collectionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM collections WHERE owner_user_id = $1 AND id = $2`, ownerID, collectionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanCollection(row scanner) (Collection, error) {
	var collection Collection
	err := row.Scan(
		&collection.ID,
		&collection.Slug,
		&collection.Title,
		&collection.Description,
		&collection.CreatedAt,
		&collection.UpdatedAt,
	)
	return collection, err
}

func slugify(title string) string {
	var slug strings.Builder
	lastHyphen := false
	for _, char := range strings.ToLower(title) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			slug.WriteRune(char)
			lastHyphen = false
			continue
		}
		if unicode.IsSpace(char) || unicode.IsPunct(char) || unicode.IsSymbol(char) {
			if slug.Len() > 0 && !lastHyphen {
				slug.WriteByte('-')
				lastHyphen = true
			}
		}
	}
	value := strings.Trim(slug.String(), "-")
	if value == "" {
		return "collection"
	}
	if len(value) > 64 {
		value = strings.TrimRight(value[:64], "-")
	}
	return value
}
