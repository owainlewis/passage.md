package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestHealth(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"database\":\"not_configured\",\"status\":\"ok\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestMeReturnsAnonymousWithoutDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"authenticated\":false}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestDocsRequireDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestStaticHandlerFallsBackToIndexForClientRoutes(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html":       {Data: []byte("<main>passage</main>")},
		"_next/app.js":     {Data: []byte("console.log('ok')")},
		"nested/index.txt": {Data: []byte("nested")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/write", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>passage</main>" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerServesExportedHTMLRoute(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html":     {Data: []byte("<main>home</main>")},
		"write.html":     {Data: []byte("<main>write</main>")},
		"write/data.txt": {Data: []byte("data")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/write", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>write</main>" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerServesHeadForIndex(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<main>home</main>"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp(os.DirFS(dir), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "/", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerReturnsNotFoundForMissingAssets(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>home</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/_next/static/missing.js", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}
