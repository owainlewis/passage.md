package documents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

func TestValidateJSONMutationRequiresJSONContentTypeAndSameOrigin(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs", strings.NewReader(`{"body":"# One"}`))
	req.Header.Set("Content-Type", "text/plain")

	if validateJSONMutation(rec, req) {
		t.Fatal("validateJSONMutation accepted a non-JSON content type")
	}
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("content-type status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs", strings.NewReader(`{"body":"# One"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://evil.test")

	if validateJSONMutation(rec, req) {
		t.Fatal("validateJSONMutation accepted a cross-origin request")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("origin status = %d", rec.Code)
	}
}

func TestValidateSameOriginAllowsSameOriginRequests(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "http://passage.test/api/v1/docs/doc-1", nil)
	req.Header.Set("Origin", "http://passage.test")

	if !validateSameOrigin(rec, req) {
		t.Fatal("validateSameOrigin rejected a same-origin request")
	}
}

func TestHandlerUsesAuthenticatedOwnerForCreateAndList(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1", Email: "u@example.com"}

	create := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs", strings.NewReader(`{"body":"# One"}`))
	createReq.Header.Set("Content-Type", "application/json")
	handler.Create(create, createReq, user, NoSavedDocumentLimit)

	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	if store.ownerID != "user-1" || store.body != "# One" {
		t.Fatalf("create owner/body = %q/%q", store.ownerID, store.body)
	}

	list := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs", nil)
	handler.List(list, listReq, user)

	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
	}
	if store.ownerID != "user-1" {
		t.Fatalf("list owner = %q", store.ownerID)
	}
}

func TestHandlerRejectsOversizedDocumentBodies(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1", Email: "u@example.com"}
	body := strings.Repeat("x", MaxDocumentBodyBytes+1)

	create := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs", strings.NewReader(`{"body":"`+body+`"}`))
	createReq.Header.Set("Content-Type", "application/json")
	handler.Create(create, createReq, user, NoSavedDocumentLimit)

	if create.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	if store.body != "" {
		t.Fatalf("oversized create reached store with body length %d", len(store.body))
	}

	update := httptest.NewRecorder()
	updateReq := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111", strings.NewReader(`{"body":"`+body+`"}`))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	handler.Update(update, updateReq, user)

	if update.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("update status = %d, body = %s", update.Code, update.Body.String())
	}
	if store.body != "" {
		t.Fatalf("oversized update reached store with body length %d", len(store.body))
	}
}

func TestHandlerReportsSavedDocumentLimit(t *testing.T) {
	store := &fakeStore{createErr: ErrLimitReached}
	handler := NewHandler(store)
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs", strings.NewReader(`{"body":"# One"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.Create(rec, req, auth.User{ID: "user-1"}, 5)

	if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "saved document limit reached") {
		t.Fatalf("status/body = %d/%s", rec.Code, rec.Body.String())
	}
	if store.maxSavedDocs != 5 {
		t.Fatalf("max saved docs = %d", store.maxSavedDocs)
	}
}

func TestHandlerRejectsOversizedDocumentRequests(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs", strings.NewReader(strings.Repeat("x", maxDocumentRequestBytes+1)))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	handler.Create(rec, req, auth.User{ID: "user-1"}, NoSavedDocumentLimit)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.body != "" {
		t.Fatalf("oversized request reached store with body length %d", len(store.body))
	}
}

func TestHandlerReturnsNotFoundForOtherUsersDocument(t *testing.T) {
	store := &fakeStore{getErr: ErrNotFound}
	handler := NewHandler(store)
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111", nil)
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")

	rec := httptest.NewRecorder()
	handler.Get(rec, req, auth.User{ID: "user-2"})

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.ownerID != "user-2" {
		t.Fatalf("owner = %q", store.ownerID)
	}
}

func TestHandlerReturnsNotFoundForMalformedDocumentID(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/not-a-uuid", nil)
	req.SetPathValue("id", "not-a-uuid")

	rec := httptest.NewRecorder()
	handler.Get(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.ownerID != "" {
		t.Fatalf("store was called with owner = %q", store.ownerID)
	}
}

func TestHandlerSharesAndUnsharesOwnedDocument(t *testing.T) {
	publicID := "abcdefghijklmnopqrstuv"
	store := &fakeStore{publicID: publicID}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1"}

	share := httptest.NewRecorder()
	shareReq := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share", nil)
	shareReq.Header.Set("Origin", "http://passage.test")
	shareReq.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	handler.Share(share, shareReq, user)

	if share.Code != http.StatusOK {
		t.Fatalf("share status = %d, body = %s", share.Code, share.Body.String())
	}
	if !strings.Contains(share.Body.String(), `"/d/abcdefghijklmnopqrstuv.md"`) {
		t.Fatalf("share body = %s", share.Body.String())
	}

	unshare := httptest.NewRecorder()
	unshareReq := httptest.NewRequest(http.MethodDelete, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share", nil)
	unshareReq.Header.Set("Origin", "http://passage.test")
	unshareReq.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	handler.Unshare(unshare, unshareReq, user)

	if unshare.Code != http.StatusNoContent {
		t.Fatalf("unshare status = %d, body = %s", unshare.Code, unshare.Body.String())
	}
}

func TestHandlerRequiresUnshareBeforeArchive(t *testing.T) {
	store := &fakeStore{archiveErr: ErrShared}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1"}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	handler.Archive(rec, req, user)

	if rec.Code != http.StatusConflict {
		t.Fatalf("archive status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "unshare this document before deleting it") {
		t.Fatalf("archive body = %s", rec.Body.String())
	}
}

func TestPublicRendersHTMLAndRawMarkdown(t *testing.T) {
	publicID := "abcdefghijklmnopqrstuv"
	store := &fakeStore{
		publicDoc: Document{
			ID:       "11111111-1111-1111-1111-111111111111",
			PublicID: publicID,
			Title:    "Shared",
			Body:     "# Shared\n\n<script>alert(1)</script>\n\nBody.",
		},
	}
	handler := NewHandler(store)

	html := httptest.NewRecorder()
	htmlReq := httptest.NewRequest(http.MethodGet, "http://passage.test/d/"+publicID, nil)
	htmlReq.SetPathValue("token", publicID)
	handler.Public(html, htmlReq)

	if html.Code != http.StatusOK {
		t.Fatalf("html status = %d, body = %s", html.Code, html.Body.String())
	}
	if !strings.Contains(html.Body.String(), "<h1>Shared</h1>") {
		t.Fatalf("html body = %s", html.Body.String())
	}
	if !regexp.MustCompile(`font-size:\s*1rem\s*;`).MatchString(html.Body.String()) {
		t.Fatalf("html does not use the compact document font size: %s", html.Body.String())
	}
	if strings.Contains(html.Body.String(), "<header>") || strings.Contains(html.Body.String(), "Shared document") || strings.Contains(html.Body.String(), "passage.md") {
		t.Fatalf("html contains share page chrome: %s", html.Body.String())
	}
	if strings.Contains(html.Body.String(), "<script>") {
		t.Fatalf("html contains unsanitized script: %s", html.Body.String())
	}
	assertPublicSecurityHeaders(t, html)

	raw := httptest.NewRecorder()
	rawReq := httptest.NewRequest(http.MethodGet, "http://passage.test/d/"+publicID+".md", nil)
	rawReq.SetPathValue("token", publicID+".md")
	handler.Public(raw, rawReq)

	if raw.Code != http.StatusOK {
		t.Fatalf("raw status = %d, body = %s", raw.Code, raw.Body.String())
	}
	if got := raw.Body.String(); got != store.publicDoc.Body {
		t.Fatalf("raw body = %q, want %q", got, store.publicDoc.Body)
	}
	assertPublicSecurityHeaders(t, raw)
}

func TestPublicConstrainsImagesToDocumentWidth(t *testing.T) {
	page, err := renderPublicHTML(Document{
		Title: "Image",
		Body:  "![A wide landscape](https://example.com/wide.jpg)",
	})
	if err != nil {
		t.Fatalf("render public HTML: %v", err)
	}

	body := string(page)
	if !strings.Contains(body, `<img src="https://example.com/wide.jpg" alt="A wide landscape">`) {
		t.Fatalf("html does not contain rendered image: %s", body)
	}
	if !regexp.MustCompile(`(?s)img\s*\{[^}]*max-width:\s*100%\s*;[^}]*height:\s*auto\s*;[^}]*\}`).MatchString(body) {
		t.Fatalf("html does not constrain images while preserving their aspect ratio: %s", body)
	}
}

func TestPublicRendersMermaidBlocks(t *testing.T) {
	publicID := "abcdefghijklmnopqrstuv"
	store := &fakeStore{
		publicDoc: Document{
			ID:       "11111111-1111-1111-1111-111111111111",
			PublicID: publicID,
			Title:    "Diagram",
			Body: "# Diagram\n\n```mermaid\nflowchart LR\n" +
				"    %% <script>alert(1)</script>\n" +
				"    A[\"Start\"] --> B[\"Done\"]\n" +
				"```\n\n```go\nfmt.Println(\"still code\")\n```",
		},
	}
	handler := NewHandler(store)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/d/"+publicID, nil)
	req.SetPathValue("token", publicID)
	handler.Public(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("html status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `<figure class="mermaidFigure"><div class="mermaid">flowchart LR`) {
		t.Fatalf("html does not contain renderable mermaid block: %s", body)
	}
	if strings.Contains(body, `<pre><code class="language-mermaid"`) {
		t.Fatalf("html still contains unrendered mermaid code block: %s", body)
	}
	if !strings.Contains(body, `cdn.jsdelivr.net/npm/mermaid@11.16.0`) {
		t.Fatalf("html does not load mermaid: %s", body)
	}
	if strings.Contains(body, `<script>alert(1)</script>`) {
		t.Fatalf("html contains unescaped mermaid content: %s", body)
	}
	if !strings.Contains(body, `<pre><code class="language-go">fmt.Println(&#34;still code&#34;)`) {
		t.Fatalf("html did not preserve normal code block: %s", body)
	}
}

type fakeStore struct {
	ownerID      string
	body         string
	maxSavedDocs int
	createErr    error
	getErr       error
	archiveErr   error
	publicID     string
	shareToken   *string
	publicDoc    Document
}

func (s *fakeStore) List(ctx context.Context, ownerID string) ([]Document, error) {
	s.ownerID = ownerID
	return []Document{{ID: "11111111-1111-1111-1111-111111111111", PublicID: "abcdefghijklmnopqrstuv", Body: "# One"}}, nil
}

func (s *fakeStore) Create(ctx context.Context, ownerID string, body string, maxSavedDocs int) (Document, error) {
	s.ownerID = ownerID
	s.body = body
	s.maxSavedDocs = maxSavedDocs
	if s.createErr != nil {
		return Document{}, s.createErr
	}
	return Document{ID: "11111111-1111-1111-1111-111111111111", PublicID: "abcdefghijklmnopqrstuv", Body: body}, nil
}

func (s *fakeStore) Get(ctx context.Context, ownerID string, id string) (Document, error) {
	s.ownerID = ownerID
	if s.getErr != nil {
		return Document{}, s.getErr
	}
	return Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Body: "# One"}, nil
}

func (s *fakeStore) Update(ctx context.Context, ownerID string, id string, body string) (Document, error) {
	s.ownerID = ownerID
	s.body = body
	return Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Body: body}, nil
}

func (s *fakeStore) Archive(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	return s.archiveErr
}

func (s *fakeStore) Share(ctx context.Context, ownerID string, id string) (Document, error) {
	s.ownerID = ownerID
	publicID := s.publicID
	if publicID == "" {
		publicID = "abcdefghijklmnopqrstuv"
	}
	return Document{ID: id, PublicID: publicID, Body: "# One", ShareToken: s.shareToken}, nil
}

func (s *fakeStore) Unshare(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	return nil
}

func (s *fakeStore) GetPublic(ctx context.Context, token string) (Document, error) {
	if s.publicDoc.ID == "" {
		return Document{}, ErrNotFound
	}
	return s.publicDoc, nil
}

func assertPublicSecurityHeaders(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := rec.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy = %q", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}
