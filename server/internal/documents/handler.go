package documents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

type Handler struct {
	store documentStore
}

func NewHandler(store documentStore) *Handler {
	return &Handler{store: store}
}

type documentStore interface {
	List(ctx context.Context, ownerID string) ([]Document, error)
	Create(ctx context.Context, ownerID string, body string) (Document, error)
	Get(ctx context.Context, ownerID string, id string) (Document, error)
	Update(ctx context.Context, ownerID string, id string, body string) (Document, error)
	Archive(ctx context.Context, ownerID string, id string) error
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request, user auth.User) {
	docs, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "documents could not be loaded")
		return
	}
	if docs == nil {
		docs = []Document{}
	}
	writeJSON(w, http.StatusOK, map[string][]Document{"documents": docs})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateJSONMutation(w, r) {
		return
	}
	var input bodyInput
	if !decodeJSON(w, r, &input) {
		return
	}
	doc, err := h.store.Create(r.Context(), user.ID, input.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "document could not be created")
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
		writeError(w, http.StatusInternalServerError, "document could not be loaded")
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
		writeError(w, http.StatusInternalServerError, "document could not be saved")
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
	if err != nil {
		writeError(w, http.StatusInternalServerError, "document could not be archived")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bodyInput struct {
	Body string `json:"body"`
}

func validateJSONMutation(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return false
	}
	return validateSameOrigin(w, r)
}

func validateSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	expected := scheme(r) + "://" + r.Host
	if origin != expected {
		writeError(w, http.StatusForbidden, "cross-origin document requests are not allowed")
		return false
	}
	return true
}

func scheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" || proto == "http" {
		return proto
	}
	return "http"
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
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
