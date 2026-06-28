package documents

import (
	"context"
	"net/http"
	"net/http/httptest"
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
	handler.Create(create, createReq, user)

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

type fakeStore struct {
	ownerID string
	body    string
	getErr  error
}

func (s *fakeStore) List(ctx context.Context, ownerID string) ([]Document, error) {
	s.ownerID = ownerID
	return []Document{{ID: "11111111-1111-1111-1111-111111111111", Body: "# One"}}, nil
}

func (s *fakeStore) Create(ctx context.Context, ownerID string, body string) (Document, error) {
	s.ownerID = ownerID
	s.body = body
	return Document{ID: "11111111-1111-1111-1111-111111111111", Body: body}, nil
}

func (s *fakeStore) Get(ctx context.Context, ownerID string, id string) (Document, error) {
	s.ownerID = ownerID
	if s.getErr != nil {
		return Document{}, s.getErr
	}
	return Document{ID: id, Body: "# One"}, nil
}

func (s *fakeStore) Update(ctx context.Context, ownerID string, id string, body string) (Document, error) {
	s.ownerID = ownerID
	s.body = body
	return Document{ID: id, Body: body}, nil
}

func (s *fakeStore) Archive(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	return nil
}
