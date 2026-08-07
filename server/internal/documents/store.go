package documents

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/owainlewis/passage.md/server/internal/database"
)

var ErrNotFound = errors.New("document not found")
var ErrShared = errors.New("shared document cannot be archived")
var ErrLimitReached = errors.New("saved document limit reached")
var errPublicIDCollision = errors.New("public id collision")

const NoSavedDocumentLimit = -1

type Document struct {
	ID         string     `json:"id"`
	PublicID   string     `json:"publicId"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	ShareToken *string    `json:"shareToken,omitempty"`
	SharedAt   *time.Time `json:"sharedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type DocumentMetadata struct {
	ID         string     `json:"id"`
	PublicID   string     `json:"publicId"`
	Title      string     `json:"title"`
	Excerpt    string     `json:"excerpt"`
	Tags       []string   `json:"tags"`
	ShareToken *string    `json:"shareToken,omitempty"`
	SharedAt   *time.Time `json:"sharedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type ListCursor struct {
	UpdatedAt time.Time
	ID        string
}

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, ownerID string) ([]Document, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, public_id, title, body, share_token, shared_at, created_at, updated_at, archived_at
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

func (s *Store) ListPage(ctx context.Context, ownerID string, limit int, cursor *ListCursor) ([]DocumentMetadata, error) {
	var cursorUpdatedAt *time.Time
	var cursorID *string
	if cursor != nil {
		cursorUpdatedAt = &cursor.UpdatedAt
		cursorID = &cursor.ID
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, public_id, left(body, 4096), share_token, shared_at, created_at, updated_at
		FROM documents
		WHERE owner_user_id = $1
		  AND archived_at IS NULL
		  AND ($2::timestamptz IS NULL OR (updated_at, id) < ($2, $3::uuid))
		ORDER BY updated_at DESC, id DESC
		LIMIT $4
	`, ownerID, cursorUpdatedAt, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	docs := []DocumentMetadata{}
	for rows.Next() {
		var doc DocumentMetadata
		if err := rows.Scan(&doc.ID, &doc.PublicID, &doc.Excerpt, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt); err != nil {
			return nil, err
		}
		doc.Title = titleOf(doc.Excerpt)
		doc.Tags = tagsOf(doc.Excerpt)
		docs = append(docs, doc)
	}
	return docs, rows.Err()
}

func (s *Store) Create(ctx context.Context, ownerID string, body string, maxSavedDocs int) (Document, error) {
	for range 5 {
		publicID, err := randomPublicID()
		if err != nil {
			return Document{}, err
		}
		doc, err := s.createWithPublicID(ctx, ownerID, body, publicID, maxSavedDocs)
		if errors.Is(err, errPublicIDCollision) {
			continue
		}
		return doc, err
	}
	return Document{}, errPublicIDCollision
}

func (s *Store) createWithPublicID(ctx context.Context, ownerID string, body string, publicID string, maxSavedDocs int) (Document, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback(ctx)

	var lockedUserID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1 FOR UPDATE`, ownerID).Scan(&lockedUserID); err != nil {
		return Document{}, err
	}
	if maxSavedDocs != NoSavedDocumentLimit {
		var savedDocs int
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM documents
			WHERE owner_user_id = $1 AND archived_at IS NULL
		`, ownerID).Scan(&savedDocs); err != nil {
			return Document{}, err
		}
		if savedDocs >= maxSavedDocs {
			return Document{}, ErrLimitReached
		}
	}

	var doc Document
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, public_id, title, body, share_token, shared_at, created_at, updated_at, archived_at
	`, ownerID, publicID, titleOf(body), body).Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Document{}, errPublicIDCollision
	}
	if err != nil {
		return Document{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Document{}, err
	}
	return doc, nil
}

func (s *Store) Get(ctx context.Context, ownerID string, id string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	var doc Document
	err := s.db.QueryRow(ctx, `
		SELECT id::text, public_id, title, body, share_token, shared_at, created_at, updated_at, archived_at
		FROM documents
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
	`, ownerID, id).Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
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
		RETURNING id::text, public_id, title, body, share_token, shared_at, created_at, updated_at, archived_at
	`, ownerID, id, titleOf(body), body).Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

func (s *Store) Archive(ctx context.Context, ownerID string, id string) error {
	if !validUUID(id) {
		return ErrNotFound
	}
	var archived bool
	var found bool
	var shared bool
	err := s.db.QueryRow(ctx, `
		WITH target AS (
			SELECT shared_at
			FROM documents
			WHERE owner_user_id = $1
			  AND id = $2
			  AND archived_at IS NULL
		),
		archived AS (
			UPDATE documents
			SET archived_at = now(),
			    updated_at = now()
			WHERE owner_user_id = $1
			  AND id = $2
			  AND archived_at IS NULL
			  AND shared_at IS NULL
			RETURNING 1
		)
		SELECT
			EXISTS (SELECT 1 FROM archived),
			EXISTS (SELECT 1 FROM target),
			EXISTS (SELECT 1 FROM target WHERE shared_at IS NOT NULL)
	`, ownerID, id).Scan(&archived, &found, &shared)
	if err != nil {
		return err
	}
	if archived {
		return nil
	}
	if shared {
		return ErrShared
	}
	if !found {
		return ErrNotFound
	}
	return ErrNotFound
}

func (s *Store) Share(ctx context.Context, ownerID string, id string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	var doc Document
	err := s.db.QueryRow(ctx, `
		UPDATE documents
		SET shared_at = COALESCE(shared_at, now()),
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		RETURNING id::text, public_id, title, body, share_token, shared_at, created_at, updated_at, archived_at
	`, ownerID, id).Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

func (s *Store) Unshare(ctx context.Context, ownerID string, id string) error {
	if !validUUID(id) {
		return ErrNotFound
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE documents
		SET shared_at = NULL,
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

func (s *Store) GetPublic(ctx context.Context, token string) (Document, error) {
	if !validPublicID(token) && !validShareToken(token) {
		return Document{}, ErrNotFound
	}
	var doc Document
	err := s.db.QueryRow(ctx, `
		SELECT id::text, public_id, title, body, share_token, shared_at, created_at, updated_at, archived_at
		FROM documents
		WHERE (public_id = $1 OR share_token = $1)
		  AND shared_at IS NOT NULL
		  AND archived_at IS NULL
	`, token).Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanDocument(row scanner) (Document, error) {
	var doc Document
	err := row.Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	return doc, err
}

func tagsOf(body string) []string {
	if !strings.HasPrefix(body, "---\n") {
		return []string{}
	}
	end := strings.Index(body[4:], "\n---")
	if end < 0 {
		return []string{}
	}
	for _, line := range strings.Split(body[4:4+end], "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "tags:") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(line, "tags:"))
		if len(value) < 2 || value[0] != '[' || value[len(value)-1] != ']' {
			return []string{}
		}
		seen := map[string]bool{}
		tags := []string{}
		for _, raw := range strings.Split(value[1:len(value)-1], ",") {
			tag := strings.TrimSpace(raw)
			if validTag(tag) && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
		return tags
	}
	return []string{}
}

func validTag(tag string) bool {
	if tag == "" {
		return false
	}
	for index, char := range tag {
		if char >= 'a' && char <= 'z' {
			continue
		}
		if char == '-' && index > 0 && index < len(tag)-1 {
			continue
		}
		return false
	}
	return !strings.Contains(tag, "--")
}

func randomPublicID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
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

func validShareToken(value string) bool {
	if len(value) != 43 {
		return false
	}
	return validURLSafeID(value)
}

func validPublicID(value string) bool {
	if len(value) != 22 && len(value) != 32 {
		return false
	}
	return validURLSafeID(value)
}

func validURLSafeID(value string) bool {
	for _, c := range value {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func titleOf(body string) string {
	for _, raw := range strings.Split(withoutFrontmatter(body), "\n") {
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

func withoutFrontmatter(body string) string {
	if !strings.HasPrefix(body, "---\n") {
		return body
	}
	end := strings.Index(body[4:], "\n---")
	if end < 0 {
		return body
	}
	return strings.TrimLeft(body[4+end+4:], "\n")
}
