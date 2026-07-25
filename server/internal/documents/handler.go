package documents

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

type Handler struct {
	store        documentStore
	secret       []byte
	cookieSecure bool
	trustProxy   bool
	now          func() time.Time
}

const (
	MaxDocumentBodyBytes    = 512 * 1024
	maxDocumentRequestBytes = MaxDocumentBodyBytes + 4096
)

// Options carries the settings the share-password flow needs. The zero value
// keeps the handler usable for the plain document endpoints.
type Options struct {
	SessionSecret string
	CookieSecure  bool
	TrustProxy    bool
}

func NewHandler(store documentStore) *Handler {
	return NewHandlerWithOptions(store, Options{})
}

func NewHandlerWithOptions(store documentStore, options Options) *Handler {
	return &Handler{
		store:        store,
		secret:       []byte(options.SessionSecret),
		cookieSecure: options.CookieSecure,
		trustProxy:   options.TrustProxy,
		now:          time.Now,
	}
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
	SetSharePassword(ctx context.Context, ownerID string, id string, hash string) (Document, error)
	ClearSharePassword(ctx context.Context, ownerID string, id string) (Document, error)
	ConsumeUnlockAttempt(ctx context.Context, ipHash string, documentHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	ResetUnlockAttempts(ctx context.Context, documentHash string) error
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
	if errors.Is(err, ErrShared) {
		writeError(w, http.StatusConflict, "unshare this document before deleting it")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "document could not be archived")
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
		writeError(w, http.StatusInternalServerError, "document could not be shared")
		return
	}
	if doc.PublicID == "" {
		writeError(w, http.StatusInternalServerError, "public id is missing")
		return
	}
	writeJSON(w, http.StatusOK, newShareResponse(doc))
}

// SetSharePassword protects an already shared document. The password is the
// only secret: the owner can hand out a bare link, or a link carrying the
// password in the URL fragment for one-click access.
func (h *Handler) SetSharePassword(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateJSONMutation(w, r) {
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	password := strings.TrimSpace(input.Password)
	if len([]rune(password)) < minSharePassword {
		writeError(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}
	if len(password) > maxSharePassword {
		writeError(w, http.StatusBadRequest, "password must be 72 bytes or fewer")
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password could not be saved")
		return
	}
	doc, err := h.store.SetSharePassword(r.Context(), user.ID, id, string(hash))
	if !h.writeSharePasswordError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, newShareResponse(doc))
}

// ClearSharePassword removes protection and leaves the document shared.
func (h *Handler) ClearSharePassword(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, http.StatusNotFound, "document not found")
		return
	}
	doc, err := h.store.ClearSharePassword(r.Context(), user.ID, id)
	if !h.writeSharePasswordError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, newShareResponse(doc))
}

func (h *Handler) writeSharePasswordError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "document not found")
	case errors.Is(err, ErrNotShared):
		writeError(w, http.StatusConflict, "share this document before adding a password")
	default:
		writeError(w, http.StatusInternalServerError, "share password could not be updated")
	}
	return false
}

// Unlock verifies a share password and grants a signed, per-document cookie.
// Form posts get a redirect so the page works without JavaScript; JSON posts
// get JSON so the unlock page can submit the fragment key in the background.
func (h *Handler) Unlock(w http.ResponseWriter, r *http.Request) {
	// Passes when Origin is absent, so the no-JavaScript form post still works.
	// It blocks a third-party page from spending a visitor's unlock budget.
	if !validateSameOrigin(w, r) {
		return
	}
	token := r.PathValue("token")
	wantsJSON := strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")

	doc, err := h.store.GetPublic(r.Context(), token)
	if errors.Is(err, ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		h.writeUnlockError(w, r, wantsJSON, http.StatusInternalServerError, "document could not be loaded")
		return
	}
	if doc.SharePasswordHash == "" {
		// Nothing to unlock. Send the visitor to the document itself.
		h.redirectToDocument(w, r, token, wantsJSON)
		return
	}

	password, ok := readUnlockPassword(w, r, wantsJSON)
	if !ok {
		return
	}

	ip := clientIP(r, h.trustProxy)
	ipHash := hashKey(ip)
	// Scoped to this client, not the document alone. See ConsumeUnlockAttempt.
	documentHash := hashKey(doc.PublicID + "|" + ip)
	retryAfter, err := h.store.ConsumeUnlockAttempt(r.Context(), ipHash, documentHash, h.now(), unlockWindow, unlockLimit)
	if errors.Is(err, ErrRateLimited) {
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		h.writeUnlockError(w, r, wantsJSON, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	if err != nil {
		slog.Error("unlock rate limit failed", "error", err)
		h.writeUnlockError(w, r, wantsJSON, http.StatusInternalServerError, "unlock failed")
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(doc.SharePasswordHash), []byte(password)) != nil {
		clearUnlockCookie(w, doc.PublicID, h.cookieSecure)
		h.writeUnlockError(w, r, wantsJSON, http.StatusUnauthorized, "that password did not work")
		return
	}

	if err := h.store.ResetUnlockAttempts(r.Context(), documentHash); err != nil {
		slog.Error("unlock rate limit reset failed", "error", err)
	}
	h.issueUnlockCookie(w, doc)
	h.redirectToDocument(w, r, token, wantsJSON)
}

func readUnlockPassword(w http.ResponseWriter, r *http.Request, wantsJSON bool) (string, bool) {
	if wantsJSON {
		var input struct {
			Password string `json:"password"`
		}
		if !decodeJSON(w, r, &input) {
			return "", false
		}
		return input.Password, true
	}
	if err := r.ParseForm(); err != nil {
		writeError(w, http.StatusBadRequest, "password is required")
		return "", false
	}
	return r.PostFormValue("password"), true
}

func (h *Handler) redirectToDocument(w http.ResponseWriter, r *http.Request, token string, wantsJSON bool) {
	if wantsJSON {
		setPublicSecurityHeaders(w)
		writeJSON(w, http.StatusOK, map[string]bool{"unlocked": true})
		return
	}
	setPublicSecurityHeaders(w)
	http.Redirect(w, r, "/d/"+token, http.StatusSeeOther)
}

func (h *Handler) writeUnlockError(w http.ResponseWriter, r *http.Request, wantsJSON bool, status int, message string) {
	setPublicSecurityHeaders(w)
	if wantsJSON {
		writeJSON(w, status, map[string]string{"error": message})
		return
	}
	publicID := strings.TrimSuffix(r.PathValue("token"), ".md")
	page, err := renderUnlockPage(publicID, message)
	if err != nil {
		http.Error(w, message, status)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(page)
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
		writeError(w, http.StatusInternalServerError, "document could not be unshared")
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
		http.Error(w, "document could not be loaded", http.StatusInternalServerError)
		return
	}
	if doc.SharePasswordHash != "" && !h.hasUnlockCookie(r, doc) {
		// The body and the title both leak content, so neither appears here.
		setPublicSecurityHeaders(w)
		if raw {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("This document is password protected. Open " + "/d/" + doc.PublicID + " to unlock it.\n"))
			return
		}
		page, err := renderUnlockPage(doc.PublicID, "")
		if err != nil {
			http.Error(w, "document could not be rendered", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write(page)
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
		http.Error(w, "document could not be rendered", http.StatusInternalServerError)
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
	Token             string `json:"token"`
	PublicID          string `json:"publicId"`
	HTMLPath          string `json:"htmlPath"`
	MarkdownPath      string `json:"markdownPath"`
	PasswordProtected bool   `json:"passwordProtected"`
}

func newShareResponse(doc Document) shareResponse {
	return shareResponse{
		Token:             doc.PublicID,
		PublicID:          doc.PublicID,
		HTMLPath:          "/d/" + doc.PublicID,
		MarkdownPath:      "/d/" + doc.PublicID + ".md",
		PasswordProtected: doc.SharePasswordHash != "",
	}
}

func setPublicSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
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
