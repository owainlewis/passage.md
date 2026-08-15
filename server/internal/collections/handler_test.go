package collections

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

func TestHandlerValidatesCollectionInputAndUsesAuthenticatedOwner(t *testing.T) {
	store := &fakeCollectionStore{}
	handler := NewHandler(store)
	user := auth.User{ID: "owner-1"}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/collections", strings.NewReader(`{"title":"  Notes  ","description":"  Useful notes.  "}`))
	request.Header.Set("Content-Type", "application/json")
	handler.Create(recorder, request, user)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if store.ownerID != user.ID || store.title != "Notes" || store.description == nil || *store.description != "Useful notes." {
		t.Fatalf("store input = owner %q, title %q, description %v", store.ownerID, store.title, store.description)
	}

	for _, input := range []string{
		`{"title":" "}`,
		`{"title":"` + strings.Repeat("a", MaxTitleCharacters+1) + `"}`,
		`{"title":"Notes","description":"` + strings.Repeat("a", MaxDescriptionCharacters+1) + `"}`,
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/collections", strings.NewReader(input))
		request.Header.Set("Content-Type", "application/json")
		handler.Create(recorder, request, user)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("input %s status = %d, body = %s", input, recorder.Code, recorder.Body.String())
		}
	}
}

func TestHandlerReportsLimitAndOwnerScopedNotFound(t *testing.T) {
	store := &fakeCollectionStore{createErr: ErrLimitReached, updateErr: ErrNotFound, deleteErr: ErrNotFound}
	handler := NewHandler(store)
	user := auth.User{ID: "owner-1"}

	create := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/collections", strings.NewReader(`{"title":"Notes"}`))
	createRequest.Header.Set("Content-Type", "application/json")
	handler.Create(create, createRequest, user)
	if create.Code != http.StatusConflict {
		t.Fatalf("create status = %d", create.Code)
	}

	update := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/collections/notes", strings.NewReader(`{"title":"Notes"}`))
	updateRequest.Header.Set("Content-Type", "application/json")
	updateRequest.SetPathValue("slug", "notes")
	handler.Update(update, updateRequest, user)
	if update.Code != http.StatusNotFound || store.ownerID != user.ID {
		t.Fatalf("update status/owner = %d/%q", update.Code, store.ownerID)
	}

	remove := httptest.NewRecorder()
	deleteRequest := httptest.NewRequest(http.MethodDelete, "http://passage.test/api/v1/collections/notes", nil)
	deleteRequest.Header.Set("Origin", "http://passage.test")
	deleteRequest.SetPathValue("slug", "notes")
	handler.Delete(remove, deleteRequest, user)
	if remove.Code != http.StatusNotFound || store.ownerID != user.ID {
		t.Fatalf("delete status/owner = %d/%q", remove.Code, store.ownerID)
	}
}

type fakeCollectionStore struct {
	ownerID     string
	title       string
	description *string
	createErr   error
	updateErr   error
	deleteErr   error
}

func (s *fakeCollectionStore) List(context.Context, string) ([]Collection, error) {
	return []Collection{}, nil
}

func (s *fakeCollectionStore) Create(_ context.Context, ownerID string, title string, description *string) (Collection, error) {
	s.ownerID = ownerID
	s.title = title
	s.description = description
	if s.createErr != nil {
		return Collection{}, s.createErr
	}
	return Collection{ID: "collection-1", Slug: "notes", Title: title, Description: description}, nil
}

func (s *fakeCollectionStore) Update(_ context.Context, ownerID string, _ string, title string, description *string) (Collection, error) {
	s.ownerID = ownerID
	s.title = title
	s.description = description
	if s.updateErr != nil {
		return Collection{}, s.updateErr
	}
	return Collection{ID: "collection-1", Slug: "notes", Title: title, Description: description}, nil
}

func (s *fakeCollectionStore) Delete(_ context.Context, ownerID string, _ string) error {
	s.ownerID = ownerID
	return s.deleteErr
}
