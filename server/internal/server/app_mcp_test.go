package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

func mcpRequest(token string, body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	return request
}

func newMCPTestApp() *App {
	return &App{
		static: fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:   auth.NewService(newRouteAuthStore(), "test-secret", false),
		docs:   documents.NewHandler(newRouteDocumentStore(), nil),
	}
}

const mcpListToolsRequest = `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`

func TestMCPRequiresABearerToken(t *testing.T) {
	handler := newMCPTestApp().Routes()

	for name, token := range map[string]string{"anonymous": "", "revoked or unknown": "psg_unknown"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, mcpRequest(token, mcpListToolsRequest))
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("%s status = %d, body = %s", name, recorder.Code, recorder.Body.String())
		}
		if !strings.HasPrefix(recorder.Header().Get("WWW-Authenticate"), "Bearer") {
			t.Fatalf("%s missing WWW-Authenticate", name)
		}
	}
}

func TestMCPListsToolsForATokenHolder(t *testing.T) {
	handler := newMCPTestApp().Routes()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, mcpRequest("psg_owner_one", mcpListToolsRequest))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	for _, tool := range []string{"search_documents", "read_document", "edit_document"} {
		if !strings.Contains(recorder.Body.String(), `"`+tool+`"`) {
			t.Fatalf("missing %s in %s", tool, recorder.Body.String())
		}
	}
}

func TestMCPReadsOnlyTheTokenOwnersDocuments(t *testing.T) {
	handler := newMCPTestApp().Routes()

	create := httptest.NewRecorder()
	handler.ServeHTTP(create, mcpRequest("psg_owner_one", `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_document","arguments":{"markdown":"# Private plan"}}}`))
	if create.Code != http.StatusOK || strings.Contains(create.Body.String(), `"isError":true`) {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}

	readAs := func(token string) string {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, mcpRequest(token, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_document","arguments":{"id":"11111111-1111-1111-1111-111111111111"}}}`))
		if recorder.Code != http.StatusOK {
			t.Fatalf("read status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
		return recorder.Body.String()
	}
	if body := readAs("psg_owner_one"); !strings.Contains(body, "Private plan") {
		t.Fatalf("owner could not read their document: %s", body)
	}
	if body := readAs("psg_owner_two"); strings.Contains(body, "Private plan") || !strings.Contains(body, "document not found") {
		t.Fatalf("another owner's document leaked: %s", body)
	}
}

func TestOldCLIGuideRedirectsToTheAgentsGuide(t *testing.T) {
	recorder := httptest.NewRecorder()
	newMCPTestApp().Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/cli", nil))
	if recorder.Code != http.StatusMovedPermanently || recorder.Header().Get("Location") != "/agents" {
		t.Fatalf("status = %d, location = %q", recorder.Code, recorder.Header().Get("Location"))
	}
}
