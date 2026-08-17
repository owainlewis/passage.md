package documents

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

type Handler struct {
	store        documentStore
	resolveActor func(*http.Request) Actor
}

const (
	MaxDocumentBodyBytes    = 512 * 1024
	maxDocumentRequestBytes = MaxDocumentBodyBytes + 4096
	defaultDocumentPageSize = 50
	maxDocumentPageSize     = 100
	maxSearchQueryLength    = 200
)

// NewHandler wires the document routes. resolveActor is retained for callers
// that want to override how a request is attributed; by default the actor is
// read from the request context, where authentication put it.
func NewHandler(store documentStore, resolveActor func(*http.Request) Actor) *Handler {
	return &Handler{store: store, resolveActor: resolveActor}
}

// actorFor answers who is making this request. Authentication already resolved
// it, so this never touches the database and cannot disagree with the identity
// the request was authorised under.
func (h *Handler) actorFor(r *http.Request) Actor {
	if h.resolveActor != nil {
		return h.resolveActor(r)
	}
	return ActorFromContext(r.Context())
}

type actorContextKey struct{}

// WithActor carries the authenticated actor on a request. A request without
// one is the owner working in a browser.
func WithActor(ctx context.Context, actor Actor) context.Context {
	return context.WithValue(ctx, actorContextKey{}, actor)
}

// ActorFromContext reads the actor authentication established.
func ActorFromContext(ctx context.Context) Actor {
	actor, _ := ctx.Value(actorContextKey{}).(Actor)
	return actor
}

type documentStore interface {
	List(ctx context.Context, ownerID string) ([]Document, error)
	ListPage(ctx context.Context, ownerID string, limit int, cursor *ListCursor) ([]DocumentMetadata, error)
	Search(ctx context.Context, ownerID string, query string, scope SearchScope, limit int, cursor *SearchCursor) ([]SearchResult, error)
	Create(ctx context.Context, ownerID string, body string, maxSavedDocs int, actor Actor) (Document, error)
	Contributors(ctx context.Context, ownerID string, id string) ([]Contributor, error)
	Get(ctx context.Context, ownerID string, id string) (Document, error)
	Update(ctx context.Context, ownerID string, id string, update DocumentUpdate) (Document, error)
	Archive(ctx context.Context, ownerID string, id string) error
	Share(ctx context.Context, ownerID string, id string) (Document, error)
	Unshare(ctx context.Context, ownerID string, id string) error
	GetPublic(ctx context.Context, token string) (Document, error)
}

type searchResponse struct {
	Documents  []SearchResult `json:"documents"`
	NextCursor string         `json:"nextCursor,omitempty"`
}

type encodedSearchCursor struct {
	Rank        float64 `json:"rank"`
	UpdatedAt   string  `json:"updatedAt"`
	ID          string  `json:"id"`
	Fingerprint string  `json:"fingerprint"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request, user auth.User) {
	if r.URL.Query().Has("limit") || r.URL.Query().Has("cursor") {
		h.listPage(w, r, user)
		return
	}
	docs, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		httpx.WriteInternalError(w, r, "list documents", err, "documents could not be loaded")
		return
	}
	if docs == nil {
		docs = []Document{}
	}
	writeJSON(w, http.StatusOK, map[string][]Document{"documents": docs})
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request, user auth.User) {
	w.Header().Set("Cache-Control", "private, no-store")
	query, err := normalizeSearchQuery(r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	collectionID := r.URL.Query().Get("collectionId")
	collectionSet := r.URL.Query().Has("collectionId")
	unfiledValue := r.URL.Query().Get("unfiled")
	unfiledSet := r.URL.Query().Has("unfiled")
	if collectionSet && unfiledSet {
		writeError(w, http.StatusBadRequest, "collectionId and unfiled are mutually exclusive")
		return
	}
	if collectionSet && !validUUID(collectionID) {
		writeError(w, http.StatusBadRequest, "collection not found")
		return
	}
	if unfiledSet && unfiledValue != "true" {
		writeError(w, http.StatusBadRequest, "unfiled must be true when provided")
		return
	}
	scope := SearchScope{Unfiled: unfiledSet}
	if collectionSet {
		scope.CollectionID = &collectionID
	}

	limit := defaultDocumentPageSize
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, parseErr := strconv.Atoi(value)
		if parseErr != nil || parsed < 1 || parsed > maxDocumentPageSize {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	fingerprint := searchFingerprint(query, scope)
	cursor, err := decodeSearchCursor(r.URL.Query().Get("cursor"), fingerprint)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid search cursor")
		return
	}
	results, err := h.store.Search(r.Context(), user.ID, query, scope, limit+1, cursor)
	if errors.Is(err, ErrEmptySearchQuery) {
		writeError(w, http.StatusBadRequest, "q must contain a searchable term")
		return
	}
	if errors.Is(err, ErrCollectionNotFound) {
		writeError(w, http.StatusBadRequest, "collection not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "search documents", err, "search unavailable")
		return
	}
	response := searchResponse{Documents: results}
	if len(results) > limit {
		response.Documents = results[:limit]
		last := response.Documents[len(response.Documents)-1]
		response.NextCursor = encodeSearchCursor(SearchCursor{
			Rank:      last.Rank,
			UpdatedAt: last.UpdatedAt,
			ID:        last.ID,
		}, fingerprint)
	}
	writeJSON(w, http.StatusOK, response)
}

func normalizeSearchQuery(value string) (string, error) {
	if !utf8.ValidString(value) {
		return "", errors.New("q must contain valid Unicode")
	}
	normalized := strings.Join(strings.Fields(value), " ")
	if strings.ContainsRune(normalized, '\x00') {
		return "", errors.New("q must not contain a zero byte")
	}
	length := utf8.RuneCountInString(normalized)
	if length < 1 || length > maxSearchQueryLength {
		return "", errors.New("q must contain between 1 and 200 characters")
	}
	return normalized, nil
}

func searchFingerprint(query string, scope SearchScope) string {
	collectionID := ""
	if scope.CollectionID != nil {
		collectionID = *scope.CollectionID
	}
	digest := sha256.Sum256([]byte(query + "\x00" + collectionID + "\x00" + strconv.FormatBool(scope.Unfiled)))
	return hex.EncodeToString(digest[:])
}

func encodeSearchCursor(cursor SearchCursor, fingerprint string) string {
	payload, _ := json.Marshal(encodedSearchCursor{
		Rank:        float64(cursor.Rank),
		UpdatedAt:   cursor.UpdatedAt.UTC().Format(time.RFC3339Nano),
		ID:          cursor.ID,
		Fingerprint: fingerprint,
	})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeSearchCursor(value string, fingerprint string) (*SearchCursor, error) {
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var encoded encodedSearchCursor
	if err := json.Unmarshal(payload, &encoded); err != nil ||
		!validUUID(encoded.ID) ||
		encoded.Fingerprint != fingerprint ||
		encoded.Rank < 0 ||
		encoded.Rank > math.MaxFloat32 ||
		math.IsNaN(encoded.Rank) ||
		math.IsInf(encoded.Rank, 0) {
		return nil, errors.New("invalid cursor")
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, encoded.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &SearchCursor{Rank: float32(encoded.Rank), UpdatedAt: updatedAt, ID: encoded.ID}, nil
}

type documentPageResponse struct {
	Documents  []DocumentMetadata `json:"documents"`
	NextCursor string             `json:"nextCursor,omitempty"`
}

type encodedListCursor struct {
	UpdatedAt string `json:"updatedAt"`
	ID        string `json:"id"`
}

func (h *Handler) listPage(w http.ResponseWriter, r *http.Request, user auth.User) {
	limit := defaultDocumentPageSize
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > maxDocumentPageSize {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	cursor, err := decodeListCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid document cursor")
		return
	}
	docs, err := h.store.ListPage(r.Context(), user.ID, limit+1, cursor)
	if err != nil {
		httpx.WriteInternalError(w, r, "list document page", err, "documents could not be loaded")
		return
	}
	response := documentPageResponse{Documents: docs}
	if len(docs) > limit {
		response.Documents = docs[:limit]
		last := response.Documents[len(response.Documents)-1]
		response.NextCursor = encodeListCursor(ListCursor{UpdatedAt: last.UpdatedAt, ID: last.ID})
	}
	writeJSON(w, http.StatusOK, response)
}

func encodeListCursor(cursor ListCursor) string {
	payload, _ := json.Marshal(encodedListCursor{UpdatedAt: cursor.UpdatedAt.UTC().Format(time.RFC3339Nano), ID: cursor.ID})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeListCursor(value string) (*ListCursor, error) {
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var encoded encodedListCursor
	if err := json.Unmarshal(payload, &encoded); err != nil || !validUUID(encoded.ID) {
		return nil, errors.New("invalid cursor")
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, encoded.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &ListCursor{UpdatedAt: updatedAt, ID: encoded.ID}, nil
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request, user auth.User, maxSavedDocs int) {
	if !validateJSONMutation(w, r) {
		return
	}
	var input bodyInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validateDocumentBody(w, input.Body) {
		return
	}
	doc, err := h.store.Create(r.Context(), user.ID, input.Body, maxSavedDocs, h.actorFor(r))
	if errors.Is(err, ErrLimitReached) {
		writeError(w, http.StatusPaymentRequired, "saved document limit reached")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "create document", err, "document could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, doc)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request, user auth.User) {
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	doc, err := h.store.Get(r.Context(), user.ID, id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "get document", err, "document could not be loaded")
		return
	}
	contributors, err := h.store.Contributors(r.Context(), user.ID, id)
	if err != nil {
		httpx.WriteInternalError(w, r, "load document contributors", err, "document could not be loaded")
		return
	}
	doc.Contributors = contributors
	writeJSON(w, http.StatusOK, doc)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateJSONMutation(w, r) {
		return
	}
	var input documentUpdateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Body == nil && !input.CollectionID.Set && input.Starred == nil {
		writeError(w, http.StatusBadRequest, "document update is empty")
		return
	}
	if input.Body != nil && !validateDocumentBody(w, *input.Body) {
		return
	}
	if input.CollectionID.Value != nil && !validUUID(*input.CollectionID.Value) {
		writeError(w, http.StatusBadRequest, "collection not found")
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	doc, err := h.store.Update(r.Context(), user.ID, id, DocumentUpdate{
		Body:            input.Body,
		CollectionIDSet: input.CollectionID.Set,
		CollectionID:    input.CollectionID.Value,
		Starred:         input.Starred,
		IfVersion:       input.Version,
		Actor:           h.actorFor(r),
	})
	if errors.Is(err, ErrVersionConflict) {
		h.writeVersionConflict(w, r, user, id)
		return
	}
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if errors.Is(err, ErrCollectionNotFound) {
		writeError(w, http.StatusBadRequest, "collection not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "update document", err, "document could not be saved")
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

// writeVersionConflict returns the stored document alongside the error, so a
// client can show what it is up against without a second round trip and
// without having to discard the draft it is holding.
func (h *Handler) writeVersionConflict(w http.ResponseWriter, r *http.Request, user auth.User, id string) {
	current, err := h.store.Get(r.Context(), user.ID, id)
	if errors.Is(err, ErrNotFound) {
		// Archived between the refused write and this read. It is gone, not
		// conflicted, and that is not a server fault.
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "load conflicting document", err, "document could not be saved")
		return
	}
	writeJSON(w, http.StatusConflict, map[string]any{
		"error":    "document changed since it was loaded",
		"document": current,
	})
}

func (h *Handler) Archive(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	err := h.store.Archive(r.Context(), user.ID, id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if errors.Is(err, ErrShared) {
		writeError(w, http.StatusConflict, "unshare this document before deleting it")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "archive document", err, "document could not be archived")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Share(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	doc, err := h.store.Share(r.Context(), user.ID, id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "share document", err, "document could not be shared")
		return
	}
	if doc.PublicID == "" {
		httpx.WriteInternalError(w, r, "share document", errors.New("store returned an empty public id"), "public id is missing")
		return
	}
	writeJSON(w, http.StatusOK, shareResponse{
		Token:        doc.PublicID,
		PublicID:     doc.PublicID,
		HTMLPath:     "/d/" + doc.PublicID,
		MarkdownPath: "/d/" + doc.PublicID + ".md",
	})
}

func (h *Handler) Unshare(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	err := h.store.Unshare(r.Context(), user.ID, id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "unshare document", err, "document could not be unshared")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Public(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	raw := false
	if strings.HasSuffix(token, ".md") {
		raw = true
		token = strings.TrimSuffix(token, ".md")
	}
	doc, err := h.store.GetPublic(r.Context(), token)
	if errors.Is(err, ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "get public document", err, "document could not be loaded")
		return
	}
	if raw {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		setPublicSecurityHeaders(w)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(doc.Body))
		return
	}
	html, err := renderPublicHTML(doc)
	if err != nil {
		httpx.WriteInternalError(w, r, "render public document", err, "document could not be rendered")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	setPublicSecurityHeaders(w)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(html)
}

type bodyInput struct {
	Body string `json:"body"`
}

type documentUpdateInput struct {
	Body         *string        `json:"body"`
	CollectionID nullableString `json:"collectionId"`
	Starred      *bool          `json:"starred"`
	// Version makes the write conditional. Omitting it keeps the
	// unconditional behaviour existing API clients depend on.
	Version *int `json:"version"`
}

type nullableString struct {
	Set   bool
	Value *string
}

func (value *nullableString) UnmarshalJSON(data []byte) error {
	value.Set = true
	if string(data) == "null" {
		value.Value = nil
		return nil
	}
	var decoded string
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	value.Value = &decoded
	return nil
}

type shareResponse struct {
	Token        string `json:"token"`
	PublicID     string `json:"publicId"`
	HTMLPath     string `json:"htmlPath"`
	MarkdownPath string `json:"markdownPath"`
}

func setPublicSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// A share URL is unguessable, but one paste somewhere public is enough for a
	// crawler to fetch a document and index it forever.
	//
	// Deliberately not paired with a robots.txt rule for /d/. A blocked page is
	// never fetched, so the crawler would never see this header, and the bare
	// URL could still be listed with no snippet. Allow the fetch, refuse the
	// index.
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
}

func validateJSONMutation(w http.ResponseWriter, r *http.Request) bool {
	return httpx.RequireJSONMutation(w, r, maxDocumentRequestBytes)
}

func validateSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	return httpx.RequireSameOrigin(w, r)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return httpx.DecodeJSON(w, r, target)
}

func validateDocumentBody(w http.ResponseWriter, body string) bool {
	if len([]byte(body)) > MaxDocumentBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "document body is too large")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
