package templates

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

const (
	MaxTitleBytes           = 120
	MaxBodyBytes            = 512 * 1024
	maxTemplateRequestBytes = MaxBodyBytes*6 + 4096
)

type templateStore interface {
	List(ctx context.Context, ownerID string) ([]Template, error)
	Create(ctx context.Context, ownerID string, title string, body string) (Template, error)
	Get(ctx context.Context, ownerID string, id string) (Template, error)
	Update(ctx context.Context, ownerID string, id string, title string, body string) (Template, error)
	Delete(ctx context.Context, ownerID string, id string) error
}

type Handler struct {
	store templateStore
}

func NewHandler(store templateStore) *Handler {
	return &Handler{store: store}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request, user auth.User) {
	templates, err := h.store.List(r.Context(), user.ID)
	if err != nil {
		httpx.WriteInternalError(w, r, "list templates", err, "templates could not be loaded")
		return
	}
	if templates == nil {
		templates = []Template{}
	}
	writeJSON(w, http.StatusOK, map[string][]Template{"templates": templates})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request, user auth.User) {
	input, ok := decodeTemplateInput(w, r)
	if !ok {
		return
	}
	template, err := h.store.Create(r.Context(), user.ID, input.Title, input.Body)
	if errors.Is(err, ErrLimitReached) {
		writeError(w, http.StatusConflict, "template limit reached")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "create template", err, "template could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, template)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request, user auth.User) {
	template, err := h.store.Get(r.Context(), user.ID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "get template", err, "template could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, template)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request, user auth.User) {
	input, ok := decodeTemplateInput(w, r)
	if !ok {
		return
	}
	template, err := h.store.Update(r.Context(), user.ID, r.PathValue("id"), input.Title, input.Body)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "update template", err, "template could not be saved")
		return
	}
	writeJSON(w, http.StatusOK, template)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !httpx.RequireSameOrigin(w, r) {
		return
	}
	err := h.store.Delete(r.Context(), user.ID, r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "delete template", err, "template could not be deleted")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type templateInput struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

func decodeTemplateInput(w http.ResponseWriter, r *http.Request) (templateInput, bool) {
	if !httpx.RequireJSONMutation(w, r, maxTemplateRequestBytes) {
		return templateInput{}, false
	}
	var input templateInput
	if !httpx.DecodeJSON(w, r, &input) {
		return templateInput{}, false
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		writeError(w, http.StatusBadRequest, "template title is required")
		return templateInput{}, false
	}
	if len([]byte(input.Title)) > MaxTitleBytes {
		writeError(w, http.StatusBadRequest, "template title is too long")
		return templateInput{}, false
	}
	if len([]byte(input.Body)) > MaxBodyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "template body is too large")
		return templateInput{}, false
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
