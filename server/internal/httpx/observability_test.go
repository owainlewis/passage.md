package httpx

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWithRequestContextUsesCloudTraceID(t *testing.T) {
	const traceID = "105445aa7843bc8bf206b12000100000"
	var observed string
	handler := WithRequestContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observed = RequestID(r)
		w.WriteHeader(http.StatusNoContent)
	}), "passage-md-prod")
	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("X-Cloud-Trace-Context", traceID+"/1;o=1")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if observed != traceID || rec.Header().Get("X-Request-ID") != traceID {
		t.Fatalf("request ID = %q, response header = %q", observed, rec.Header().Get("X-Request-ID"))
	}
}

func TestWriteInternalErrorLogsSafeRequestContext(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	handler := WithRequestContext(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Pattern = "POST /api/v1/docs/{id}"
		WriteInternalError(w, r, "save document", errors.New("database unavailable"), "document could not be saved")
	}), "passage-md-prod")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/docs/doc-id", strings.NewReader(`{"body":"private document"}`))
	req.Header.Set("X-Cloud-Trace-Context", "105445aa7843bc8bf206b12000100000/1;o=1")
	req.Header.Set("Cookie", "passage_session=secret-cookie")
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	logged := output.String()
	for _, want := range []string{
		`"request_id":"105445aa7843bc8bf206b12000100000"`,
		`"route":"POST /api/v1/docs/{id}"`,
		`"operation":"save document"`,
		`"error":"database unavailable"`,
		`"logging.googleapis.com/trace":"projects/passage-md-prod/traces/105445aa7843bc8bf206b12000100000"`,
	} {
		if !strings.Contains(logged, want) {
			t.Fatalf("log %q does not contain %q", logged, want)
		}
	}
	for _, forbidden := range []string{"private document", "secret-cookie", "secret-token"} {
		if strings.Contains(logged, forbidden) {
			t.Fatalf("log contains sensitive value %q: %s", forbidden, logged)
		}
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
}
