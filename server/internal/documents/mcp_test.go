package documents

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/owainlewis/passage.md/server/internal/auth"
)

const mcpDocID = "11111111-1111-1111-1111-111111111111"

// mcpStore keeps one versioned document, so edits and conflicts behave like
// the real store's version guard.
type mcpStore struct {
	fakeStore
	doc Document
	// beforeUpdate runs ahead of each Update, standing in for the owner's
	// autosave landing between an agent's read and its write.
	beforeUpdate func(*mcpStore)
	updates      int
}

func (s *mcpStore) Get(ctx context.Context, ownerID string, id string) (Document, error) {
	s.ownerID = ownerID
	if id != s.doc.ID {
		return Document{}, ErrNotFound
	}
	return s.doc, nil
}

func (s *mcpStore) Update(ctx context.Context, ownerID string, id string, update DocumentUpdate) (Document, error) {
	s.updates++
	if s.beforeUpdate != nil {
		s.beforeUpdate(s)
	}
	if id != s.doc.ID {
		return Document{}, ErrNotFound
	}
	if update.IfVersion != nil && *update.IfVersion != s.doc.Version {
		return Document{}, ErrVersionConflict
	}
	s.update = update
	s.doc.Body = *update.Body
	s.doc.Title = titleOf(s.doc.Body)
	s.doc.Version++
	return s.doc, nil
}

func newMCPStore(body string) *mcpStore {
	return &mcpStore{doc: Document{ID: mcpDocID, PublicID: "abcdefghijklmnopqrstuv", Title: titleOf(body), Body: body, Version: 1}}
}

func connectMCP(t *testing.T, store documentStore, opts MCPOptions) *mcp.ClientSession {
	t.Helper()
	server := NewHandler(store, nil).MCPServer(auth.User{ID: "owner-1"}, Actor{TokenID: "token-1", TokenName: "Claude"}, opts)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func callTool(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) (map[string]any, string, bool) {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	text := ""
	for _, content := range result.Content {
		if c, ok := content.(*mcp.TextContent); ok {
			text += c.Text
		}
	}
	var structured map[string]any
	if result.StructuredContent != nil {
		raw, _ := json.Marshal(result.StructuredContent)
		_ = json.Unmarshal(raw, &structured)
	}
	return structured, text, result.IsError
}

func TestMCPListsTheDocumentTools(t *testing.T) {
	session := connectMCP(t, newMCPStore("# One"), MCPOptions{})
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	want := "append_to_document,create_document,edit_document,list_documents,read_document,search_documents"
	if got := strings.Join(names, ","); got != want {
		t.Fatalf("tools = %s", got)
	}
}

func TestMCPReadReturnsTheBodyAndAnOwnerLink(t *testing.T) {
	store := newMCPStore("# Plan\n\nShip it.")
	session := connectMCP(t, store, MCPOptions{AppBaseURL: "https://passage.example/"})

	out, text, isError := callTool(t, session, "read_document", map[string]any{"id": mcpDocID})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if out["body"] != "# Plan\n\nShip it." || out["title"] != "Plan" {
		t.Fatalf("read = %v", out)
	}
	if out["url"] != "https://passage.example/write/abcdefghijklmnopqrstuv" {
		t.Fatalf("url = %v", out["url"])
	}
	if store.ownerID != "owner-1" {
		t.Fatalf("owner = %q", store.ownerID)
	}

	_, text, isError = callTool(t, session, "read_document", map[string]any{"id": "not-a-uuid"})
	if !isError || !strings.Contains(text, "document not found") {
		t.Fatalf("bad id = %v %s", isError, text)
	}
}

func TestMCPSearchNormalizesTheQueryAndChargesTheSearchLimit(t *testing.T) {
	store := newMCPStore("# One")
	store.search = []SearchResult{{ID: mcpDocID, Title: "Agent notes", MatchExcerpt: "the agent workflow"}}
	var charged []string
	session := connectMCP(t, store, MCPOptions{Allow: func(ctx context.Context, kind string) error {
		charged = append(charged, kind)
		return nil
	}})

	out, text, isError := callTool(t, session, "search_documents", map[string]any{"query": "  agent   workflow "})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if store.searchQuery != "agent workflow" || store.searchLimit != mcpDefaultPageSize {
		t.Fatalf("query = %q limit = %d", store.searchQuery, store.searchLimit)
	}
	docs := out["documents"].([]any)
	if len(docs) != 1 || docs[0].(map[string]any)["excerpt"] != "the agent workflow" {
		t.Fatalf("documents = %v", docs)
	}
	if strings.Join(charged, ",") != "search" {
		t.Fatalf("charged = %v", charged)
	}

	_, text, isError = callTool(t, session, "search_documents", map[string]any{"query": "   "})
	if !isError || !strings.Contains(text, "query must contain") {
		t.Fatalf("empty query = %v %s", isError, text)
	}
}

func TestMCPListPagesWithACursor(t *testing.T) {
	store := newMCPStore("# One")
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	store.page = []DocumentMetadata{
		{ID: mcpDocID, Title: "One", UpdatedAt: now},
		{ID: "22222222-2222-2222-2222-222222222222", Title: "Two", UpdatedAt: now},
	}
	session := connectMCP(t, store, MCPOptions{})

	out, text, isError := callTool(t, session, "list_documents", map[string]any{"limit": 1})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if store.pageLimit != 2 {
		t.Fatalf("page limit = %d", store.pageLimit)
	}
	if docs := out["documents"].([]any); len(docs) != 1 {
		t.Fatalf("documents = %v", docs)
	}
	cursor, _ := out["nextCursor"].(string)
	if cursor == "" {
		t.Fatalf("missing cursor: %v", out)
	}

	callTool(t, session, "list_documents", map[string]any{"cursor": cursor})
	if store.pageCursor == nil || store.pageCursor.ID != mcpDocID {
		t.Fatalf("cursor = %+v", store.pageCursor)
	}
}

func TestMCPCreateAttributesTheTokenAndKeepsTheDocumentLimit(t *testing.T) {
	store := newMCPStore("# One")
	session := connectMCP(t, store, MCPOptions{MaxSavedDocs: func(context.Context) (int, error) { return 5, nil }})

	out, text, isError := callTool(t, session, "create_document", map[string]any{"markdown": "# Draft"})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if out["id"] != mcpDocID || store.body != "# Draft" || store.maxSavedDocs != 5 {
		t.Fatalf("create = %v body = %q max = %d", out, store.body, store.maxSavedDocs)
	}
	if store.actor.TokenID != "token-1" {
		t.Fatalf("actor = %+v", store.actor)
	}

	store.createErr = ErrLimitReached
	_, text, isError = callTool(t, session, "create_document", map[string]any{"markdown": "# Another"})
	if !isError || !strings.Contains(text, "limit reached") {
		t.Fatalf("limit = %v %s", isError, text)
	}
}

func TestMCPEditReplacesExactlyOnePassage(t *testing.T) {
	store := newMCPStore("# Plan\n\nFirst draft.\n\nKeep this.")
	session := connectMCP(t, store, MCPOptions{})

	_, text, isError := callTool(t, session, "edit_document", map[string]any{"id": mcpDocID, "oldText": "First draft.", "newText": "Final copy."})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if store.doc.Body != "# Plan\n\nFinal copy.\n\nKeep this." {
		t.Fatalf("body = %q", store.doc.Body)
	}
	if store.update.IfVersion == nil || *store.update.IfVersion != 1 || store.update.Actor.TokenID != "token-1" {
		t.Fatalf("update = %+v", store.update)
	}
}

func TestMCPEditRefusesMissingAndAmbiguousPassages(t *testing.T) {
	store := newMCPStore("# Plan\n\nRepeat.\n\nRepeat.")
	session := connectMCP(t, store, MCPOptions{})

	_, text, isError := callTool(t, session, "edit_document", map[string]any{"id": mcpDocID, "oldText": "Repeat.", "newText": "Once."})
	if !isError || !strings.Contains(text, "appears 2 times") {
		t.Fatalf("ambiguous = %v %s", isError, text)
	}
	_, text, isError = callTool(t, session, "edit_document", map[string]any{"id": mcpDocID, "oldText": "Missing", "newText": "x"})
	if !isError || !strings.Contains(text, "not found") {
		t.Fatalf("missing = %v %s", isError, text)
	}
	if store.updates != 0 {
		t.Fatalf("updates = %d", store.updates)
	}
}

func TestMCPEditRebuildsOnTheOwnersLatestText(t *testing.T) {
	store := newMCPStore("# Plan\n\nIntro.")
	typed := false
	store.beforeUpdate = func(s *mcpStore) {
		if typed {
			return
		}
		// The owner's autosave lands after the agent read the document.
		typed = true
		s.doc.Body = "# Plan\n\nIntro.\n\nJust typed."
		s.doc.Version++
	}
	session := connectMCP(t, store, MCPOptions{})

	_, text, isError := callTool(t, session, "edit_document", map[string]any{"id": mcpDocID, "oldText": "Intro.", "newText": "Better intro."})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if store.doc.Body != "# Plan\n\nBetter intro.\n\nJust typed." {
		t.Fatalf("owner text lost: %q", store.doc.Body)
	}
	if store.updates != 2 {
		t.Fatalf("updates = %d", store.updates)
	}
}

func TestMCPEditGivesUpWhenTheDocumentKeepsChanging(t *testing.T) {
	store := newMCPStore("# Plan\n\nIntro.")
	store.beforeUpdate = func(s *mcpStore) { s.doc.Version++ }
	session := connectMCP(t, store, MCPOptions{})

	_, text, isError := callTool(t, session, "edit_document", map[string]any{"id": mcpDocID, "oldText": "Intro.", "newText": "x"})
	if !isError || !strings.Contains(text, "kept changing") {
		t.Fatalf("result = %v %s", isError, text)
	}
	if store.updates != mcpWriteAttempts {
		t.Fatalf("updates = %d", store.updates)
	}
}

func TestMCPAppendAddsABlankLineBeforeTheNewText(t *testing.T) {
	store := newMCPStore("# Log\n\nMonday.\n")
	session := connectMCP(t, store, MCPOptions{})

	_, text, isError := callTool(t, session, "append_to_document", map[string]any{"id": mcpDocID, "markdown": "\nTuesday.\n\n"})
	if isError {
		t.Fatalf("error: %s", text)
	}
	if store.doc.Body != "# Log\n\nMonday.\n\nTuesday.\n" {
		t.Fatalf("body = %q", store.doc.Body)
	}
}

func TestMCPWritesStopAtTheMutationLimit(t *testing.T) {
	store := newMCPStore("# Log")
	session := connectMCP(t, store, MCPOptions{Allow: func(ctx context.Context, kind string) error {
		if kind == "mutation" {
			return errors.New("rate limit exceeded; retry in 30 seconds")
		}
		return nil
	}})

	_, text, isError := callTool(t, session, "append_to_document", map[string]any{"id": mcpDocID, "markdown": "More."})
	if !isError || !strings.Contains(text, "rate limit exceeded") {
		t.Fatalf("result = %v %s", isError, text)
	}
	if store.updates != 0 {
		t.Fatalf("updates = %d", store.updates)
	}
	if _, text, isError := callTool(t, session, "read_document", map[string]any{"id": mcpDocID}); isError {
		t.Fatalf("reads are not limited: %s", text)
	}
}

func TestMCPRefusesOversizedBodies(t *testing.T) {
	store := newMCPStore("# Log")
	session := connectMCP(t, store, MCPOptions{})

	_, text, isError := callTool(t, session, "append_to_document", map[string]any{"id": mcpDocID, "markdown": strings.Repeat("a", MaxDocumentBodyBytes)})
	if !isError || !strings.Contains(text, "too large") {
		t.Fatalf("result = %v %s", isError, text)
	}
	if store.updates != 0 {
		t.Fatalf("updates = %d", store.updates)
	}
}
