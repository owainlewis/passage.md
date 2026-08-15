package collections

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

const (
	MaxTitleCharacters        = 80
	MaxDescriptionCharacters  = 180
	maxCollectionRequestBytes = 4096
)

type collectionStore interface {
	List(ctx context.Context, ownerID string) ([]Collection, error)
	Create(ctx context.Context, ownerID string, title string, description *string) (Collection, error)
	Update(ctx context.Context, ownerID string, slug string, title string, description *string) (Collection, error)
	Delete(ctx context.Context, ownerID string, slug string) error
}

type Handler struct {
	store collectionStore
}

func NewHandler(store collectionStore) *Handler {
	return &Handler{store: store}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request, user auth.User) {
	collections, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		httpx.WriteInternalError(w, r, "list collections", err, "collections could not be loaded")
		return
	}
	if collections == nil {
		collections = []Collection{}
	}
	writeJSON(w, http.StatusOK, map[string][]Collection{"collections": collections})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request, user auth.User) {
	input, ok := decodeCollectionInput(w, r)
	if !ok {
		return
	}
	collection, err := h.store.Create(r.Context(), user.ID, input.Title, input.Description)
	if errors.Is(err, ErrLimitReached) {
		writeError(w, http.StatusConflict, "collection limit reached")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "create collection", err, "collection could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, collection)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request, user auth.User) {
	input, ok := decodeCollectionInput(w, r)
	if !ok {
		return
	}
	collection, err := h.store.Update(r.Context(), user.ID, r.PathValue("slug"), input.Title, input.Description)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "collection not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "update collection", err, "collection could not be saved")
		return
	}
	writeJSON(w, http.StatusOK, collection)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !httpx.RequireSameOrigin(w, r) {
		return
	}
	err := h.store.Delete(r.Context(), user.ID, r.PathValue("slug"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "collection not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "delete collection", err, "collection could not be deleted")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type collectionInput struct {
	Title       string  `json:"title"`
	Description *string `json:"description"`
}

func decodeCollectionInput(w http.ResponseWriter, r *http.Request) (collectionInput, bool) {
	if !httpx.RequireJSONMutation(w, r, maxCollectionRequestBytes) {
		return collectionInput{}, false
	}
	var input collectionInput
	if !httpx.DecodeJSON(w, r, &input) {
		return collectionInput{}, false
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Description != nil {
		description := strings.TrimSpace(*input.Description)
		if description == "" {
			input.Description = nil
		} else {
			input.Description = &description
		}
	}
	if input.Title == "" {
		writeError(w, http.StatusBadRequest, "collection title is required")
		return collectionInput{}, false
	}
	if utf8.RuneCountInString(input.Title) > MaxTitleCharacters {
		writeError(w, http.StatusBadRequest, "collection title is too long")
		return collectionInput{}, false
	}
	if input.Description != nil && utf8.RuneCountInString(*input.Description) > MaxDescriptionCharacters {
		writeError(w, http.StatusBadRequest, "collection description is too long")
		return collectionInput{}, false
	}
	return input, true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
