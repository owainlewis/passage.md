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
var ErrCollectionNotFound = errors.New("collection not found")
var ErrEmptySearchQuery = errors.New("search query has no searchable terms")
var ErrShared = errors.New("shared document cannot be archived")
var ErrLimitReached = errors.New("saved document limit reached")
var ErrVersionConflict = errors.New("document changed since it was loaded")
var errPublicIDCollision = errors.New("public id collision")

const NoSavedDocumentLimit = -1

type Document struct {
	ID             string        `json:"id"`
	PublicID       string        `json:"publicId"`
	Title          string        `json:"title"`
	Body           string        `json:"body"`
	CollectionID   *string       `json:"collectionId"`
	CollectionSlug *string       `json:"collectionSlug"`
	Starred        bool          `json:"starred"`
	Version        int           `json:"version"`
	LastEditor     *LastEditor   `json:"lastEditor,omitempty"`
	Contributors   []Contributor `json:"contributors,omitempty"`
	ShareToken     *string       `json:"shareToken,omitempty"`
	SharedAt       *time.Time    `json:"sharedAt,omitempty"`
	CreatedAt      time.Time     `json:"createdAt"`
	UpdatedAt      time.Time     `json:"updatedAt"`
	ArchivedAt     *time.Time    `json:"archivedAt,omitempty"`
}

type DocumentMetadata struct {
	ID             string      `json:"id"`
	PublicID       string      `json:"publicId"`
	Title          string      `json:"title"`
	Excerpt        string      `json:"excerpt"`
	Tags           []string    `json:"tags"`
	CollectionID   *string     `json:"collectionId"`
	CollectionSlug *string     `json:"collectionSlug"`
	Starred        bool        `json:"starred"`
	Version        int         `json:"version"`
	LastEditor     *LastEditor `json:"lastEditor,omitempty"`
	ShareToken     *string     `json:"shareToken,omitempty"`
	SharedAt       *time.Time  `json:"sharedAt,omitempty"`
	CreatedAt      time.Time   `json:"createdAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
}

type SearchResult struct {
	ID             string     `json:"id"`
	PublicID       string     `json:"publicId"`
	Title          string     `json:"title"`
	MatchExcerpt   string     `json:"matchExcerpt"`
	Tags           []string   `json:"tags"`
	CollectionID   *string    `json:"collectionId"`
	CollectionSlug *string    `json:"collectionSlug"`
	Starred        bool       `json:"starred"`
	ShareToken     *string    `json:"shareToken,omitempty"`
	SharedAt       *time.Time `json:"sharedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	Rank           float32    `json:"-"`
}

type SearchScope struct {
	CollectionID *string
	Unfiled      bool
}

type SearchCursor struct {
	Rank      float32
	UpdatedAt time.Time
	ID        string
}

// OwnerActorKey is the contributor key for the account holder writing in a
// browser. API tokens contribute under their own id.
const OwnerActorKey = "owner"

// Actor is who is performing a content write, as resolved by the server.
// A zero Actor means the owner in a browser.
type Actor struct {
	TokenID   string
	TokenName string
}

func (a Actor) key() string {
	if a.TokenID == "" {
		return OwnerActorKey
	}
	return a.TokenID
}

func (a Actor) name() *string {
	if a.TokenName == "" {
		return nil
	}
	name := a.TokenName
	return &name
}

// Contributor is one identity that has changed a document's content.
type Contributor struct {
	ActorKey string    `json:"actorKey"`
	Name     *string   `json:"name"`
	IsOwner  bool      `json:"isOwner"`
	FirstAt  time.Time `json:"firstContributedAt"`
	LastAt   time.Time `json:"lastContributedAt"`
}

// LastEditor summarises the most recent content change.
type LastEditor struct {
	ActorKey string     `json:"actorKey"`
	Name     *string    `json:"name"`
	IsOwner  bool       `json:"isOwner"`
	At       *time.Time `json:"at"`
}

type DocumentUpdate struct {
	// Actor attributes a content change. Ignored for metadata-only updates,
	// because sharing, starring and filing are not content contributions.
	Actor           Actor
	Body            *string
	CollectionIDSet bool
	CollectionID    *string
	Starred         *bool
	// IfVersion makes the write conditional on the document still being at
	// this version. Nil keeps the unconditional behaviour older clients rely
	// on.
	IfVersion *int
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
		SELECT d.id::text, d.public_id, d.title, d.body,
		       d.collection_id::text, c.slug, d.starred, d.content_version,
		       d.last_editor_key, d.last_editor_name, d.last_edited_at,
		       d.share_token, d.shared_at, d.created_at, d.updated_at, d.archived_at
		FROM documents d
		LEFT JOIN collections c ON c.owner_user_id = d.owner_user_id AND c.id = d.collection_id
		WHERE d.owner_user_id = $1
		  AND d.archived_at IS NULL
		ORDER BY d.updated_at DESC
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
		SELECT d.id::text, d.public_id, left(d.body, 4096),
		       d.collection_id::text, c.slug, d.starred, d.content_version,
		       d.last_editor_key, d.last_editor_name, d.last_edited_at,
		       d.share_token, d.shared_at, d.created_at, d.updated_at
		FROM documents d
		LEFT JOIN collections c ON c.owner_user_id = d.owner_user_id AND c.id = d.collection_id
		WHERE d.owner_user_id = $1
		  AND d.archived_at IS NULL
		  AND ($2::timestamptz IS NULL OR (d.updated_at, d.id) < ($2, $3::uuid))
		ORDER BY d.updated_at DESC, d.id DESC
		LIMIT $4
	`, ownerID, cursorUpdatedAt, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	docs := []DocumentMetadata{}
	for rows.Next() {
		var doc DocumentMetadata
		var editorKey, editorName *string
		var editedAt *time.Time
		if err := rows.Scan(
			&doc.ID,
			&doc.PublicID,
			&doc.Excerpt,
			&doc.CollectionID,
			&doc.CollectionSlug,
			&doc.Starred,
			&doc.Version,
			&editorKey,
			&editorName,
			&editedAt,
			&doc.ShareToken,
			&doc.SharedAt,
			&doc.CreatedAt,
			&doc.UpdatedAt,
		); err != nil {
			return nil, err
		}
		doc.Title = titleOf(doc.Excerpt)
		doc.Tags = tagsOf(doc.Excerpt)
		docs = append(docs, doc)
	}
	return docs, rows.Err()
}

func (s *Store) Search(ctx context.Context, ownerID string, query string, scope SearchScope, limit int, cursor *SearchCursor) ([]SearchResult, error) {
	var queryNodes int
	if err := s.db.QueryRow(ctx, `
		SELECT numnode(websearch_to_tsquery('simple'::regconfig, $1))
	`, query).Scan(&queryNodes); err != nil {
		return nil, err
	}
	if queryNodes == 0 {
		return nil, ErrEmptySearchQuery
	}
	if scope.CollectionID != nil {
		var exists bool
		if err := s.db.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM collections
				WHERE owner_user_id = $1 AND id = $2
			)
		`, ownerID, *scope.CollectionID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrCollectionNotFound
		}
	}

	var cursorRank *float32
	var cursorUpdatedAt *time.Time
	var cursorID *string
	if cursor != nil {
		cursorRank = &cursor.Rank
		cursorUpdatedAt = &cursor.UpdatedAt
		cursorID = &cursor.ID
	}
	rows, err := s.db.Query(ctx, `
		WITH search_query AS (
			SELECT websearch_to_tsquery('simple'::regconfig, $2) AS value
		), ranked AS (
			SELECT
				d.id,
				d.public_id,
				d.title,
				d.body,
				left(d.body, 4096) AS body_start,
				d.collection_id,
				c.slug AS collection_slug,
				d.starred,
				d.share_token,
				d.shared_at,
				d.created_at,
				d.updated_at,
				ts_rank_cd(d.search_vector, search_query.value) AS rank
			FROM documents d
			LEFT JOIN collections c
			  ON c.owner_user_id = d.owner_user_id AND c.id = d.collection_id
			CROSS JOIN search_query
			WHERE d.owner_user_id = $1
			  AND d.archived_at IS NULL
			  AND ($3::uuid IS NULL OR d.collection_id = $3)
			  AND (NOT $4::boolean OR d.collection_id IS NULL)
			  AND d.search_vector @@ search_query.value
		), page AS (
			SELECT *
			FROM ranked
			WHERE $5::real IS NULL
			   OR (rank, updated_at, id) < ($5, $6::timestamptz, $7::uuid)
			ORDER BY rank DESC, updated_at DESC, id DESC
			LIMIT $8
		)
		SELECT
			page.id::text,
			page.public_id,
			page.title,
			page.body_start,
			left(
				replace(
					replace(
						ts_headline(
							'simple'::regconfig,
							page.title || E'\n' || page.body,
							search_query.value,
							'StartSel=<<<passage>>>, StopSel=<<</passage>>>, MaxWords=35, MinWords=15, ShortWord=2, MaxFragments=1, FragmentDelimiter= … '
						),
						'<<<passage>>>',
						''
					),
					'<<</passage>>>',
					''
				),
				240
			) AS match_excerpt,
			page.collection_id::text,
			page.collection_slug,
			page.starred,
			page.share_token,
			page.shared_at,
			page.created_at,
			page.updated_at,
			page.rank
		FROM page
		CROSS JOIN search_query
		ORDER BY page.rank DESC, page.updated_at DESC, page.id DESC
	`, ownerID, query, scope.CollectionID, scope.Unfiled, cursorRank, cursorUpdatedAt, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := []SearchResult{}
	for rows.Next() {
		var result SearchResult
		var bodyStart string
		if err := rows.Scan(
			&result.ID,
			&result.PublicID,
			&result.Title,
			&bodyStart,
			&result.MatchExcerpt,
			&result.CollectionID,
			&result.CollectionSlug,
			&result.Starred,
			&result.ShareToken,
			&result.SharedAt,
			&result.CreatedAt,
			&result.UpdatedAt,
			&result.Rank,
		); err != nil {
			return nil, err
		}
		result.MatchExcerpt = strings.TrimSpace(result.MatchExcerpt)
		result.Tags = tagsOf(bodyStart)
		results = append(results, result)
	}
	return results, rows.Err()
}

func (s *Store) Create(ctx context.Context, ownerID string, body string, maxSavedDocs int, actor Actor) (Document, error) {
	for range 5 {
		publicID, err := randomPublicID()
		if err != nil {
			return Document{}, err
		}
		doc, err := s.createWithPublicID(ctx, ownerID, body, publicID, maxSavedDocs, actor)
		if errors.Is(err, errPublicIDCollision) {
			continue
		}
		return doc, err
	}
	return Document{}, errPublicIDCollision
}

func (s *Store) createWithPublicID(ctx context.Context, ownerID string, body string, publicID string, maxSavedDocs int, actor Actor) (Document, error) {
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
	var editorKey, editorName *string
	var editedAt *time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body,
		                       last_editor_key, last_editor_name, last_edited_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		RETURNING id::text, public_id, title, body,
		          collection_id::text, NULL::text, starred, content_version,
		          last_editor_key, last_editor_name, last_edited_at,
		          share_token, shared_at, created_at, updated_at, archived_at
	`, ownerID, publicID, titleOf(body), body, actor.key(), actor.name()).Scan(
		&doc.ID,
		&doc.PublicID,
		&doc.Title,
		&doc.Body,
		&doc.CollectionID,
		&doc.CollectionSlug,
		&doc.Starred,
		&doc.Version,
		&editorKey,
		&editorName,
		&editedAt,
		&doc.ShareToken,
		&doc.SharedAt,
		&doc.CreatedAt,
		&doc.UpdatedAt,
		&doc.ArchivedAt,
	)
	doc.LastEditor = lastEditorOf(editorKey, editorName, editedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Document{}, errPublicIDCollision
	}
	if err != nil {
		return Document{}, err
	}
	if err := recordContribution(ctx, tx, doc.ID, actor); err != nil {
		return Document{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Document{}, err
	}
	doc.LastEditor = &LastEditor{
		ActorKey: actor.key(),
		Name:     actor.name(),
		IsOwner:  !actor.IsAPIToken(),
		At:       &doc.UpdatedAt,
	}
	return doc, nil
}

// IsAPIToken reports whether this actor is an API token rather than the owner
// working in a browser.
func (a Actor) IsAPIToken() bool { return a.TokenID != "" }

// recordContribution opens or refreshes one contributor row per identity, so
// repeated autosaves by the same writer do not create duplicates.
func recordContribution(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, documentID string, actor Actor) error {
	_, err := q.Exec(ctx, `
		INSERT INTO document_contributors (document_id, actor_key, actor_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (document_id, actor_key) DO UPDATE
		SET last_contributed_at = now(),
		    actor_name = COALESCE(EXCLUDED.actor_name, document_contributors.actor_name)
	`, documentID, actor.key(), actor.name())
	return err
}

// Contributors lists every identity that has changed a document's content,
// most recent first. Owner-scoped: a document that is not yours returns
// nothing rather than leaking who has been writing to it.
func (s *Store) Contributors(ctx context.Context, ownerID string, id string) ([]Contributor, error) {
	if !validUUID(id) {
		return nil, ErrNotFound
	}
	rows, err := s.db.Query(ctx, `
		SELECT c.actor_key, c.actor_name, c.first_contributed_at, c.last_contributed_at
		FROM document_contributors c
		JOIN documents d ON d.id = c.document_id
		WHERE c.document_id = $1 AND d.owner_user_id = $2
		ORDER BY c.last_contributed_at DESC
	`, id, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contributors := []Contributor{}
	for rows.Next() {
		var contributor Contributor
		if err := rows.Scan(&contributor.ActorKey, &contributor.Name, &contributor.FirstAt, &contributor.LastAt); err != nil {
			return nil, err
		}
		contributor.IsOwner = contributor.ActorKey == OwnerActorKey
		contributors = append(contributors, contributor)
	}
	return contributors, rows.Err()
}

func (s *Store) Get(ctx context.Context, ownerID string, id string) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	var doc Document
	var editorKey, editorName *string
	var editedAt *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT d.id::text, d.public_id, d.title, d.body,
		       d.collection_id::text, c.slug, d.starred, d.content_version,
		       d.last_editor_key, d.last_editor_name, d.last_edited_at,
		       d.share_token, d.shared_at, d.created_at, d.updated_at, d.archived_at
		FROM documents d
		LEFT JOIN collections c ON c.owner_user_id = d.owner_user_id AND c.id = d.collection_id
		WHERE d.owner_user_id = $1
		  AND d.id = $2
		  AND d.archived_at IS NULL
	`, ownerID, id).Scan(
		&doc.ID,
		&doc.PublicID,
		&doc.Title,
		&doc.Body,
		&doc.CollectionID,
		&doc.CollectionSlug,
		&doc.Starred,
		&doc.Version,
		&editorKey,
		&editorName,
		&editedAt,
		&doc.ShareToken,
		&doc.SharedAt,
		&doc.CreatedAt,
		&doc.UpdatedAt,
		&doc.ArchivedAt,
	)
	doc.LastEditor = lastEditorOf(editorKey, editorName, editedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return doc, err
}

func (s *Store) Update(ctx context.Context, ownerID string, id string, update DocumentUpdate) (Document, error) {
	if !validUUID(id) {
		return Document{}, ErrNotFound
	}
	body := ""
	bodySet := update.Body != nil
	if bodySet {
		body = *update.Body
	}
	starred := false
	starredSet := update.Starred != nil
	if starredSet {
		starred = *update.Starred
	}
	var doc Document
	var editorKey, editorName *string
	var editedAt *time.Time
	// The version guard lives in the UPDATE's WHERE clause so the compare and
	// the write are one statement. Two concurrent writers holding the same
	// version cannot both match: the second blocks on the row lock, then sees
	// the incremented value and matches nothing.
	err := s.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE documents d
			SET title = CASE WHEN $3 THEN $4 ELSE d.title END,
			    body = CASE WHEN $3 THEN $5 ELSE d.body END,
			    collection_id = CASE WHEN $6 THEN $7 ELSE d.collection_id END,
			    starred = CASE WHEN $8 THEN $9 ELSE d.starred END,
			    content_version = CASE WHEN $3 THEN d.content_version + 1 ELSE d.content_version END,
			    last_editor_key = CASE WHEN $3 THEN $11 ELSE d.last_editor_key END,
			    last_editor_name = CASE WHEN $3 THEN $12 ELSE d.last_editor_name END,
			    last_edited_at = CASE WHEN $3 THEN now() ELSE d.last_edited_at END,
			    updated_at = now()
			WHERE d.owner_user_id = $1
			  AND d.id = $2
			  AND d.archived_at IS NULL
			  AND ($10::integer IS NULL OR d.content_version = $10)
			  AND (
			    NOT $6
			    OR $7::uuid IS NULL
			    OR EXISTS (
			      SELECT 1 FROM collections c
			      WHERE c.owner_user_id = $1 AND c.id = $7
			    )
			  )
			RETURNING d.*
		)
		SELECT d.id::text, d.public_id, d.title, d.body,
		       d.collection_id::text, c.slug, d.starred, d.content_version,
		       d.last_editor_key, d.last_editor_name, d.last_edited_at,
		       d.share_token, d.shared_at, d.created_at, d.updated_at, d.archived_at
		FROM updated d
		LEFT JOIN collections c ON c.owner_user_id = d.owner_user_id AND c.id = d.collection_id
	`, ownerID, id, bodySet, titleOf(body), body, update.CollectionIDSet, update.CollectionID, starredSet, starred, update.IfVersion, update.Actor.key(), update.Actor.name()).Scan(
		&doc.ID,
		&doc.PublicID,
		&doc.Title,
		&doc.Body,
		&doc.CollectionID,
		&doc.CollectionSlug,
		&doc.Starred,
		&doc.Version,
		&editorKey,
		&editorName,
		&editedAt,
		&doc.ShareToken,
		&doc.SharedAt,
		&doc.CreatedAt,
		&doc.UpdatedAt,
		&doc.ArchivedAt,
	)
	doc.LastEditor = lastEditorOf(editorKey, editorName, editedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// One statement decides both whether the row is still there and what
		// version it holds. Asking separately leaves a window where an archive
		// between the two reads surfaces as an unmapped no-row error.
		var currentVersion int
		versionErr := s.db.QueryRow(ctx, `
			SELECT content_version FROM documents
			WHERE owner_user_id = $1 AND id = $2 AND archived_at IS NULL
		`, ownerID, id).Scan(&currentVersion)
		if errors.Is(versionErr, pgx.ErrNoRows) {
			return Document{}, ErrNotFound
		}
		if versionErr != nil {
			return Document{}, versionErr
		}
		if update.IfVersion != nil && currentVersion != *update.IfVersion {
			// The row is still ours, so the guard is what rejected the write.
			return Document{}, ErrVersionConflict
		}
		if update.CollectionIDSet && update.CollectionID != nil {
			return Document{}, ErrCollectionNotFound
		}
		return Document{}, ErrNotFound
	}
	if err != nil {
		return Document{}, err
	}
	// Only content counts as a contribution. Sharing, filing and starring are
	// metadata, and attributing them would make an agent that starred a
	// document look like it had written one.
	if bodySet {
		if contribErr := recordContribution(ctx, s.db, doc.ID, update.Actor); contribErr != nil {
			return Document{}, contribErr
		}
		doc.LastEditor = &LastEditor{
			ActorKey: update.Actor.key(),
			Name:     update.Actor.name(),
			IsOwner:  !update.Actor.IsAPIToken(),
			At:       &doc.UpdatedAt,
		}
	}
	return doc, nil
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
	var editorKey, editorName *string
	var editedAt *time.Time
	err := s.db.QueryRow(ctx, `
		WITH updated AS (
		UPDATE documents
		SET shared_at = COALESCE(shared_at, now()),
		    updated_at = now()
		WHERE owner_user_id = $1
		  AND id = $2
		  AND archived_at IS NULL
		RETURNING *
		)
		SELECT d.id::text, d.public_id, d.title, d.body,
		       d.collection_id::text, c.slug, d.starred, d.content_version,
		       d.last_editor_key, d.last_editor_name, d.last_edited_at,
		       d.share_token, d.shared_at, d.created_at, d.updated_at, d.archived_at
		FROM updated d
		LEFT JOIN collections c ON c.owner_user_id = d.owner_user_id AND c.id = d.collection_id
	`, ownerID, id).Scan(
		&doc.ID,
		&doc.PublicID,
		&doc.Title,
		&doc.Body,
		&doc.CollectionID,
		&doc.CollectionSlug,
		&doc.Starred,
		&doc.Version,
		&editorKey,
		&editorName,
		&editedAt,
		&doc.ShareToken,
		&doc.SharedAt,
		&doc.CreatedAt,
		&doc.UpdatedAt,
		&doc.ArchivedAt,
	)
	doc.LastEditor = lastEditorOf(editorKey, editorName, editedAt)
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
	doc, err := scanDocument(s.db.QueryRow(ctx, `
		SELECT id::text, public_id, title, body,
		       NULL::text, NULL::text, false, content_version,
		       NULL::text, NULL::text, NULL::timestamptz,
		       share_token, shared_at, created_at, updated_at, archived_at
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

type scanner interface {
	Scan(dest ...any) error
}

func scanDocument(row scanner) (Document, error) {
	var doc Document
	var editorKey, editorName *string
	var editedAt *time.Time
	err := row.Scan(
		&doc.ID,
		&doc.PublicID,
		&doc.Title,
		&doc.Body,
		&doc.CollectionID,
		&doc.CollectionSlug,
		&doc.Starred,
		&doc.Version,
		&editorKey,
		&editorName,
		&editedAt,
		&doc.ShareToken,
		&doc.SharedAt,
		&doc.CreatedAt,
		&doc.UpdatedAt,
		&doc.ArchivedAt,
	)
	doc.LastEditor = lastEditorOf(editorKey, editorName, editedAt)
	doc.LastEditor = lastEditorOf(editorKey, editorName, editedAt)
	return doc, err
}

// lastEditorOf folds the three stored columns into a summary. A document that
// has not been written since attribution shipped has no last editor rather
// than a fabricated one.
func lastEditorOf(key *string, name *string, at *time.Time) *LastEditor {
	if key == nil {
		return nil
	}
	return &LastEditor{
		ActorKey: *key,
		Name:     name,
		IsOwner:  *key == OwnerActorKey,
		At:       at,
	}
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
