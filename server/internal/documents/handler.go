package documents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

type Handler struct {
	store documentStore
}

const (
	MaxDocumentBodyBytes    = 512 * 1024
	maxDocumentRequestBytes = MaxDocumentBodyBytes + 4096
)

func NewHandler(store documentStore) *Handler {
	return &Handler{store: store}
}

type documentStore interface {
	List(ctx context.Context, ownerID string) ([]Document, error)
	Create(ctx context.Context, ownerID string, body string, maxSavedDocs int) (Document, error)
	Get(ctx context.Context, ownerID string, id string) (Document, error)
	Update(ctx context.Context, ownerID string, id string, body string) (Document, error)
	Archive(ctx context.Context, ownerID string, id string) error
	Share(ctx context.Context, ownerID string, id string) (Document, error)
	Unshare(ctx context.Context, ownerID string, id string) error
	GetPublic(ctx context.Context, token string) (Document, error)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request, user auth.User) {
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
	doc, err := h.store.Create(r.Context(), user.ID, input.Body, maxSavedDocs)
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
	writeJSON(w, http.StatusOK, doc)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request, user auth.User) {
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
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	doc, err := h.store.Update(r.Context(), user.ID, id, input.Body)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "update document", err, "document could not be saved")
		return
	}
	writeJSON(w, http.StatusOK, doc)
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
