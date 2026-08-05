package templates

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

type handlerStore struct {
	createdTitle       string
	createdDescription string
	createdBody        string
	createErr          error
}

func (s *handlerStore) List(context.Context, string) ([]Template, error) {
	return []Template{}, nil
}

func (s *handlerStore) Create(_ context.Context, _ string, title string, description string, body string) (Template, error) {
	s.createdTitle = title
	s.createdDescription = description
	s.createdBody = body
	if s.createErr != nil {
		return Template{}, s.createErr
	}
	return Template{ID: "11111111-1111-1111-1111-111111111111", Title: title, Description: description, Body: body}, nil
}

func (s *handlerStore) Get(context.Context, string, string) (Template, error) {
	return Template{}, ErrNotFound
}

func (s *handlerStore) Update(context.Context, string, string, string, string, string) (Template, error) {
	return Template{}, ErrNotFound
}

func (s *handlerStore) Delete(context.Context, string, string) error {
	return ErrNotFound
}

func TestCreateValidatesAndStoresPlainMarkdown(t *testing.T) {
	store := &handlerStore{}
	handler := NewHandler(store)
	user := auth.User{ID: "user-1"}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(`{"title":"  Video script  ","description":"  Plan a concise product video.  ","body":"# [Title]\n\nOpening"}`))
	request.Header.Set("Content-Type", "application/json")

	handler.Create(recorder, request, user)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if store.createdTitle != "Video script" || store.createdDescription != "Plan a concise product video." || store.createdBody != "# [Title]\n\nOpening" {
		t.Fatalf("stored title/description/body = %q/%q/%q", store.createdTitle, store.createdDescription, store.createdBody)
	}
}

func TestCreateAllowsEscapedMarkdownWithinDecodedBodyLimit(t *testing.T) {
	body := strings.Repeat("\n", 300_000)
	payload, err := json.Marshal(map[string]string{"title": "Outline", "body": body})
	if err != nil {
		t.Fatal(err)
	}
	store := &handlerStore{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(string(payload)))
	request.Header.Set("Content-Type", "application/json")

	NewHandler(store).Create(recorder, request, auth.User{ID: "user-1"})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if store.createdBody != body {
		t.Fatalf("stored body length = %d, want %d", len(store.createdBody), len(body))
	}
}

func TestCreateRejectsMissingTitleAndMapsLimit(t *testing.T) {
	t.Run("missing title", func(t *testing.T) {
		store := &handlerStore{}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(`{"title":" ","body":"body"}`))
		request.Header.Set("Content-Type", "application/json")

		NewHandler(store).Create(recorder, request, auth.User{ID: "user-1"})

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("limit", func(t *testing.T) {
		store := &handlerStore{createErr: ErrLimitReached}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(`{"title":"Eleventh","body":"body"}`))
		request.Header.Set("Content-Type", "application/json")

		NewHandler(store).Create(recorder, request, auth.User{ID: "user-1"})

		if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "template limit reached") {
			t.Fatalf("status/body = %d/%s", recorder.Code, recorder.Body.String())
		}
	})
}

func TestCreateRejectsLongDescription(t *testing.T) {
	store := &handlerStore{}
	payload, err := json.Marshal(map[string]string{
		"title":       "Outline",
		"description": strings.Repeat("a", MaxDescriptionCharacters+1),
		"body":        "# Outline",
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(string(payload)))
	request.Header.Set("Content-Type", "application/json")

	NewHandler(store).Create(recorder, request, auth.User{ID: "user-1"})

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "template description is too long") {
		t.Fatalf("status/body = %d/%s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateAllowsMultibyteDescriptionWithinCharacterLimit(t *testing.T) {
	description := strings.Repeat("é", MaxDescriptionCharacters)
	payload, err := json.Marshal(map[string]string{
		"title":       "Outline",
		"description": description,
		"body":        "# Outline",
	})
	if err != nil {
		t.Fatal(err)
	}
	store := &handlerStore{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/templates", strings.NewReader(string(payload)))
	request.Header.Set("Content-Type", "application/json")

	NewHandler(store).Create(recorder, request, auth.User{ID: "user-1"})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status/body = %d/%s", recorder.Code, recorder.Body.String())
	}
	if store.createdDescription != description {
		t.Fatalf("stored description length = %d, want %d characters", utf8.RuneCountInString(store.createdDescription), MaxDescriptionCharacters)
	}
}
