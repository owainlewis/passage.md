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
var ErrNotShared = errors.New("document is not shared")
var ErrRateLimited = errors.New("too many unlock attempts")
var errPublicIDCollision = errors.New("public id collision")

const NoSavedDocumentLimit = -1

type Document struct {
	ID                string     `json:"id"`
	PublicID          string     `json:"publicId"`
	Title             string     `json:"title"`
	Body              string     `json:"body"`
	ShareToken        *string    `json:"shareToken,omitempty"`
	SharedAt          *time.Time `json:"sharedAt,omitempty"`
	PasswordProtected bool       `json:"passwordProtected"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	ArchivedAt        *time.Time `json:"archivedAt,omitempty"`

	// SharePasswordHash never leaves the server.
	SharePasswordHash string `json:"-"`
}

// documentColumns is the single source of truth for the document projection.
// share_password_hash is coalesced so every scan target stays a plain string.
const documentColumns = `id::text, public_id, title, body, share_token, shared_at,
		COALESCE(share_password_hash, ''), created_at, updated_at, archived_at`

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) List(ctx context.Context, ownerID string) ([]Document, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+documentColumns+`
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

	doc, err := scanDocument(tx.QueryRow(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body)
		VALUES ($1, $2, $3, $4)
		RETURNING `+documentColumns+`
	`, ownerID, publicID, titleOf(body), body))
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
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		SELECT `+documentColumns+`
		FROM documents
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
	`, ownerID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

func (s *Store) Update(ctx context.Context, ownerID string, id string, body string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		UPDATE documents
		SET title = $3,
		    body = $4,
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		RETURNING `+documentColumns+`
	`, ownerID, id, titleOf(body), body))
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
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		UPDATE documents
		SET shared_at = COALESCE(shared_at, now()),
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		RETURNING `+documentColumns+`
	`, ownerID, id))
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
		    share_password_hash = NULL,
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
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		SELECT `+documentColumns+`
		FROM documents
		WHERE (public_id = $1 OR share_token = $1)
		  AND shared_at IS NOT NULL
		  AND archived_at IS NULL
	`, token))
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

// SetSharePassword stores a bcrypt hash for a document that is already shared.
// Protecting an unshared document is meaningless, so it is rejected rather than
// silently sharing the document as a side effect.
func (s *Store) SetSharePassword(ctx context.Context, ownerID string, id string, hash string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		UPDATE documents
		SET share_password_hash = $3,
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		  AND shared_at IS NOT NULL
		RETURNING `+documentColumns+`
	`, ownerID, id, hash))
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, s.classifyMissingShare(ctx, ownerID, id)
	}
	return doc, err
}

// ClearSharePassword removes protection and leaves the document shared.
func (s *Store) ClearSharePassword(ctx context.Context, ownerID string, id string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		UPDATE documents
		SET share_password_hash = NULL,
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		  AND shared_at IS NOT NULL
		RETURNING `+documentColumns+`
	`, ownerID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, s.classifyMissingShare(ctx, ownerID, id)
	}
	return doc, err
}

// classifyMissingShare separates "no such document" from "document is not shared"
// so the caller can return an actionable error instead of a blanket 404.
func (s *Store) classifyMissingShare(ctx context.Context, ownerID string, id string) error {
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM documents
			WHERE owner_user_id = $1 AND id = $2 AND archived_at IS NULL
		)
	`, ownerID, id).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return ErrNotShared
	}
	return ErrNotFound
}

// ConsumeUnlockAttempt records one unlock attempt and returns ErrRateLimited
// with a retry delay once either dimension exceeds the limit inside the window.
//
// Both dimensions are scoped to the client. The caller keys documentHash on the
// document AND the client IP, never the document alone: an attempt is consumed
// before the password is checked, so a document-wide counter would let anyone
// holding the public link spend the whole budget and lock every genuine reader
// out of that document. bcrypt, not a global counter, is what makes a
// distributed guessing attack expensive.
func (s *Store) ConsumeUnlockAttempt(ctx context.Context, ipHash string, documentHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM document_unlock_rate_limits
		WHERE window_started_at < ($1::timestamptz - interval '24 hours')
	`, now); err != nil {
		return 0, err
	}

	retryAfter := time.Duration(0)
	for _, key := range []struct {
		dimension string
		hash      string
	}{{"ip", ipHash}, {"document", documentHash}} {
		var attempts int
		var started time.Time
		err := tx.QueryRow(ctx, `
			INSERT INTO document_unlock_rate_limits (dimension, key_hash, window_started_at, attempts)
			VALUES ($1, $2, $3, 1)
			ON CONFLICT (dimension, key_hash) DO UPDATE SET
				window_started_at = CASE
					WHEN document_unlock_rate_limits.window_started_at <= $3 - $4::interval THEN $3
					ELSE document_unlock_rate_limits.window_started_at
				END,
				attempts = CASE
					WHEN document_unlock_rate_limits.window_started_at <= $3 - $4::interval THEN 1
					ELSE document_unlock_rate_limits.attempts + 1
				END
			RETURNING attempts, window_started_at
		`, key.dimension, key.hash, now, window).Scan(&attempts, &started)
		if err != nil {
			return 0, err
		}
		if attempts > limit {
			if wait := window - now.Sub(started); wait > retryAfter {
				retryAfter = wait
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

// ResetUnlockAttempts clears this client's counter for one document after a
// correct password, so an honest visitor who mistyped a few times is not locked
// out. The cross-document IP counter is deliberately left alone: clearing it
// would let anyone who knows one document's password wipe their own broader
// budget and keep scanning other documents.
func (s *Store) ResetUnlockAttempts(ctx context.Context, documentHash string) error {
	_, err := s.db.Exec(ctx, `
		DELETE FROM document_unlock_rate_limits
		WHERE dimension = 'document' AND key_hash = $1
	`, documentHash)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanDocument(row scanner) (Document, error) {
	var doc Document
	err := row.Scan(&doc.ID, &doc.PublicID, &doc.Title, &doc.Body, &doc.ShareToken, &doc.SharedAt, &doc.SharePasswordHash, &doc.CreatedAt, &doc.UpdatedAt, &doc.ArchivedAt)
	doc.PasswordProtected = doc.SharePasswordHash != ""
	return doc, err
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
