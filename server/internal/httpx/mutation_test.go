package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONReturnsRequestTooLargeForStreamedBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/mutation", strings.NewReader(`{"value":"`+strings.Repeat("x", 128)+`"}`))
	req.ContentLength = -1
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	if !RequireJSONMutation(rec, req, 32) {
		t.Fatalf("request rejected before streaming: %d %s", rec.Code, rec.Body.String())
	}
	var input struct {
		Value string `json:"value"`
	}
	if DecodeJSON(rec, req, &input) {
		t.Fatal("oversized request decoded")
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestDecodeJSONChecksTrailingStreamedBytes(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/mutation", strings.NewReader(`{"value":"ok"}`+strings.Repeat(" ", 128)))
	req.ContentLength = -1
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	if !RequireJSONMutation(rec, req, 32) {
		t.Fatalf("request rejected before streaming: %d %s", rec.Code, rec.Body.String())
	}
	var input struct {
		Value string `json:"value"`
	}
	if DecodeJSON(rec, req, &input) {
		t.Fatal("request with oversized trailing bytes decoded")
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestDecodeJSONRejectsMultipleValues(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/mutation", strings.NewReader(`{"value":"one"} {"value":"two"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	if !RequireJSONMutation(rec, req, 128) {
		t.Fatalf("request rejected before decoding: %d %s", rec.Code, rec.Body.String())
	}
	var input struct {
		Value string `json:"value"`
	}
	if DecodeJSON(rec, req, &input) {
		t.Fatal("request with multiple JSON values decoded")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestRequireSameOriginUsesForwardedScheme(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/mutation", nil)
	req.Host = "passage.test"
	req.Header.Set("Origin", "https://passage.test")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	if !RequireSameOrigin(rec, req) {
		t.Fatalf("same origin rejected: %d %s", rec.Code, rec.Body.String())
	}
}
