package documents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

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

func TestHandlerListsBoundedMetadataPagesWithoutBodies(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{page: []DocumentMetadata{
		{ID: "11111111-1111-1111-1111-111111111113", Title: "Three", Excerpt: "third", UpdatedAt: now},
		{ID: "11111111-1111-1111-1111-111111111112", Title: "Two", Excerpt: "second", UpdatedAt: now.Add(-time.Minute)},
		{ID: "11111111-1111-1111-1111-111111111111", Title: "One", Excerpt: "first", UpdatedAt: now.Add(-2 * time.Minute)},
	}}
	handler := NewHandler(store)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs?limit=2", nil)

	handler.List(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.pageLimit != 3 || store.ownerID != "user-1" {
		t.Fatalf("page owner/limit = %q/%d", store.ownerID, store.pageLimit)
	}
	var response documentPageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Documents) != 2 || response.NextCursor == "" {
		t.Fatalf("documents/cursor = %d/%q", len(response.Documents), response.NextCursor)
	}
	if strings.Contains(rec.Body.String(), `"body"`) {
		t.Fatalf("paginated response included a body: %s", rec.Body.String())
	}
	cursor, err := decodeListCursor(response.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if cursor.ID != response.Documents[1].ID || !cursor.UpdatedAt.Equal(response.Documents[1].UpdatedAt) {
		t.Fatalf("cursor = %+v, want last returned document", cursor)
	}
}

func TestHandlerRejectsInvalidDocumentPagination(t *testing.T) {
	handler := NewHandler(&fakeStore{})
	for _, target := range []string{
		"http://passage.test/api/v1/docs?limit=0",
		"http://passage.test/api/v1/docs?limit=101",
		"http://passage.test/api/v1/docs?limit=nope",
		"http://passage.test/api/v1/docs?cursor=not-a-cursor",
	} {
		rec := httptest.NewRecorder()
		handler.List(rec, httptest.NewRequest(http.MethodGet, target, nil), auth.User{ID: "user-1"})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, body = %s", target, rec.Code, rec.Body.String())
		}
	}
}

func TestHandlerSearchesBoundedMetadataWithScopeAndOpaqueCursor(t *testing.T) {
	now := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)
	collectionID := "22222222-2222-2222-2222-222222222222"
	store := &fakeStore{search: []SearchResult{
		{ID: "11111111-1111-1111-1111-111111111113", Title: "Three", MatchExcerpt: "third match", Rank: 0.9, UpdatedAt: now},
		{ID: "11111111-1111-1111-1111-111111111112", Title: "Two", MatchExcerpt: "second match", Rank: 0.8, UpdatedAt: now.Add(-time.Minute)},
		{ID: "11111111-1111-1111-1111-111111111111", Title: "One", MatchExcerpt: "first match", Rank: 0.7, UpdatedAt: now.Add(-2 * time.Minute)},
	}}
	handler := NewHandler(store)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/search?q=%20agent%20%20work%20&collectionId="+collectionID+"&limit=2", nil)

	handler.Search(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.ownerID != "user-1" || store.searchQuery != "agent work" || store.searchScope.CollectionID == nil || *store.searchScope.CollectionID != collectionID || store.searchLimit != 3 {
		t.Fatalf("search inputs = owner %q query %q scope %+v limit %d", store.ownerID, store.searchQuery, store.searchScope, store.searchLimit)
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	var response searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Documents) != 2 || response.NextCursor == "" {
		t.Fatalf("documents/cursor = %d/%q", len(response.Documents), response.NextCursor)
	}
	if strings.Contains(rec.Body.String(), `"body"`) || strings.Contains(rec.Body.String(), `"rank"`) {
		t.Fatalf("search response exposed internal fields: %s", rec.Body.String())
	}
	fingerprint := searchFingerprint("agent work", SearchScope{CollectionID: &collectionID})
	cursor, err := decodeSearchCursor(response.NextCursor, fingerprint)
	if err != nil {
		t.Fatal(err)
	}
	if cursor.ID != response.Documents[1].ID || cursor.Rank != store.search[1].Rank || !cursor.UpdatedAt.Equal(response.Documents[1].UpdatedAt) {
		t.Fatalf("cursor = %+v, want final returned result", cursor)
	}

	next := httptest.NewRecorder()
	nextReq := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/search?q=agent+work&collectionId="+collectionID+"&limit=2&cursor="+response.NextCursor, nil)
	handler.Search(next, nextReq, auth.User{ID: "user-1"})
	if next.Code != http.StatusOK || store.searchCursor == nil || store.searchCursor.ID != response.Documents[1].ID {
		t.Fatalf("next status/cursor = %d/%+v", next.Code, store.searchCursor)
	}

	mismatch := httptest.NewRecorder()
	mismatchReq := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/search?q=agent+work&unfiled=true&cursor="+response.NextCursor, nil)
	handler.Search(mismatch, mismatchReq, auth.User{ID: "user-1"})
	if mismatch.Code != http.StatusBadRequest {
		t.Fatalf("mismatched cursor status = %d, body = %s", mismatch.Code, mismatch.Body.String())
	}
}

func TestHandlerRejectsInvalidSearchInputsWithoutCallingStore(t *testing.T) {
	invalidUTF8 := string([]byte{0xff})
	collectionID := "22222222-2222-2222-2222-222222222222"
	tests := []struct {
		name   string
		target string
	}{
		{name: "missing query", target: "http://passage.test/api/v1/docs/search"},
		{name: "blank query", target: "http://passage.test/api/v1/docs/search?q=+++"},
		{name: "long query", target: "http://passage.test/api/v1/docs/search?q=" + strings.Repeat("a", 201)},
		{name: "invalid unicode", target: "http://passage.test/api/v1/docs/search?q=" + invalidUTF8},
		{name: "zero byte", target: "http://passage.test/api/v1/docs/search?q=%00"},
		{name: "invalid collection", target: "http://passage.test/api/v1/docs/search?q=agent&collectionId=not-a-uuid"},
		{name: "invalid unfiled", target: "http://passage.test/api/v1/docs/search?q=agent&unfiled=false"},
		{name: "conflicting scope", target: "http://passage.test/api/v1/docs/search?q=agent&collectionId=" + collectionID + "&unfiled=true"},
		{name: "zero limit", target: "http://passage.test/api/v1/docs/search?q=agent&limit=0"},
		{name: "large limit", target: "http://passage.test/api/v1/docs/search?q=agent&limit=101"},
		{name: "invalid limit", target: "http://passage.test/api/v1/docs/search?q=agent&limit=many"},
		{name: "invalid cursor", target: "http://passage.test/api/v1/docs/search?q=agent&cursor=invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeStore{}
			handler := NewHandler(store)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, test.target, nil)
			handler.Search(rec, req, auth.User{ID: "user-1"})
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if store.ownerID != "" {
				t.Fatalf("store called for owner %q", store.ownerID)
			}
		})
	}
}

func TestHandlerReportsParsedQueryAndCollectionErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{name: "empty parsed query", err: ErrEmptySearchQuery, want: "searchable term"},
		{name: "missing collection", err: ErrCollectionNotFound, want: "collection not found"},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeStore{searchErr: test.err}
			handler := NewHandler(store)
			rec := httptest.NewRecorder()
			handler.Search(rec, httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/search?q=%21%21%21", nil), auth.User{ID: "user-1"})
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), test.want) {
				t.Fatalf("status/body = %d/%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestNormalizeSearchQueryUsesUnicodeCharacterLimit(t *testing.T) {
	value := strings.Repeat("é", maxSearchQueryLength)
	if normalized, err := normalizeSearchQuery(" \t" + value + "\n"); err != nil || normalized != value {
		t.Fatalf("maximum query = %q/%v", normalized, err)
	}
	if _, err := normalizeSearchQuery(value + "é"); err == nil {
		t.Fatal("overlong Unicode query was accepted")
	}
}

func TestHandlerReportsSearchFailureWithoutDroppingPrivateCachePolicy(t *testing.T) {
	store := &fakeStore{searchErr: errors.New("database unavailable")}
	handler := NewHandler(store)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/api/v1/docs/search?q=agent", nil)

	handler.Search(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "search unavailable") {
		t.Fatalf("status/body = %d/%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
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

func TestHandlerKeepsBodyOnlyUpdatesCompatibleAndSupportsMetadataOnlyUpdates(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1"}
	id := "11111111-1111-1111-1111-111111111111"

	bodyOnly := httptest.NewRecorder()
	bodyRequest := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/docs/"+id, strings.NewReader(`{"body":"# Updated"}`))
	bodyRequest.Header.Set("Content-Type", "application/json")
	bodyRequest.SetPathValue("id", id)
	handler.Update(bodyOnly, bodyRequest, user)
	if bodyOnly.Code != http.StatusOK || store.update.Body == nil || *store.update.Body != "# Updated" {
		t.Fatalf("body-only status/update = %d/%#v", bodyOnly.Code, store.update)
	}
	if store.update.CollectionIDSet || store.update.Starred != nil {
		t.Fatalf("body-only update changed metadata: %#v", store.update)
	}

	collectionID := "22222222-2222-2222-2222-222222222222"
	metadataOnly := httptest.NewRecorder()
	metadataRequest := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/docs/"+id, strings.NewReader(`{"collectionId":"`+collectionID+`","starred":true}`))
	metadataRequest.Header.Set("Content-Type", "application/json")
	metadataRequest.SetPathValue("id", id)
	handler.Update(metadataOnly, metadataRequest, user)
	if metadataOnly.Code != http.StatusOK || store.update.Body != nil || !store.update.CollectionIDSet || store.update.CollectionID == nil || *store.update.CollectionID != collectionID || store.update.Starred == nil || !*store.update.Starred {
		t.Fatalf("metadata-only status/update = %d/%#v", metadataOnly.Code, store.update)
	}

	unfiled := httptest.NewRecorder()
	unfiledRequest := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/docs/"+id, strings.NewReader(`{"collectionId":null}`))
	unfiledRequest.Header.Set("Content-Type", "application/json")
	unfiledRequest.SetPathValue("id", id)
	handler.Update(unfiled, unfiledRequest, user)
	if unfiled.Code != http.StatusOK || !store.update.CollectionIDSet || store.update.CollectionID != nil {
		t.Fatalf("unfiled status/update = %d/%#v", unfiled.Code, store.update)
	}
}

func TestHandlerRejectsEmptyAndInvalidCollectionUpdates(t *testing.T) {
	store := &fakeStore{}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1"}
	id := "11111111-1111-1111-1111-111111111111"
	for _, input := range []string{`{}`, `{"collectionId":"another-owner"}`} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/docs/"+id, strings.NewReader(input))
		request.Header.Set("Content-Type", "application/json")
		request.SetPathValue("id", id)
		handler.Update(recorder, request, user)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("input %s status = %d, body = %s", input, recorder.Code, recorder.Body.String())
		}
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
			Body: "# Shared\n\n<script>alert(1)</script>\n\n" +
				`<img src=x onerror="alert(2)"><iframe src="https://evil.test"></iframe>` +
				"\n\nBody.",
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
	if strings.Contains(html.Body.String(), "onerror=") ||
		strings.Contains(html.Body.String(), "<iframe") {
		t.Fatalf("html contains executable hostile markup: %s", html.Body.String())
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
	if !strings.Contains(body, `<script type="module" src="/assets/public-mermaid.mjs"></script>`) {
		t.Fatalf("html does not load the local Mermaid module: %s", body)
	}
	if strings.Contains(body, "cdn.jsdelivr.net") || strings.Contains(body, `src="https://`) {
		t.Fatalf("html loads third-party executable code: %s", body)
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
	update       DocumentUpdate
	maxSavedDocs int
	createErr    error
	getErr       error
	archiveErr   error
	publicID     string
	shareToken   *string
	publicDoc    Document
	page         []DocumentMetadata
	pageLimit    int
	pageCursor   *ListCursor
	search       []SearchResult
	searchErr    error
	searchQuery  string
	searchScope  SearchScope
	searchLimit  int
	searchCursor *SearchCursor
}

func (s *fakeStore) Search(ctx context.Context, ownerID string, query string, scope SearchScope, limit int, cursor *SearchCursor) ([]SearchResult, error) {
	s.ownerID = ownerID
	s.searchQuery = query
	s.searchScope = scope
	s.searchLimit = limit
	s.searchCursor = cursor
	return s.search, s.searchErr
}

func (s *fakeStore) List(ctx context.Context, ownerID string) ([]Document, error) {
	s.ownerID = ownerID
	return []Document{{ID: "11111111-1111-1111-1111-111111111111", PublicID: "abcdefghijklmnopqrstuv", Body: "# One"}}, nil
}

func (s *fakeStore) ListPage(ctx context.Context, ownerID string, limit int, cursor *ListCursor) ([]DocumentMetadata, error) {
	s.ownerID = ownerID
	s.pageLimit = limit
	s.pageCursor = cursor
	return s.page, nil
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

func (s *fakeStore) Update(ctx context.Context, ownerID string, id string, update DocumentUpdate) (Document, error) {
	s.ownerID = ownerID
	s.update = update
	if update.Body != nil {
		s.body = *update.Body
	}
	return Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Body: s.body}, nil
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
	const wantCSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'"
	if got := rec.Header().Get("Content-Security-Policy"); got != wantCSP {
		t.Fatalf("Content-Security-Policy = %q, want %q", got, wantCSP)
	}
	if got := rec.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy = %q", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if got := rec.Header().Get("X-Robots-Tag"); got != "noindex, nofollow" {
		t.Fatalf("X-Robots-Tag = %q, want %q", got, "noindex, nofollow")
	}
}

func TestPublicHTMLCarriesARobotsMetaTag(t *testing.T) {
	page, err := renderPublicHTML(Document{Title: "Quarterly numbers", Body: "# Quarterly numbers"})
	if err != nil {
		t.Fatalf("render public HTML: %v", err)
	}
	if !strings.Contains(string(page), `<meta name="robots" content="noindex, nofollow">`) {
		t.Fatalf("public html has no robots meta tag: %s", page)
	}
}
