package documents

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/owainlewis/passage.md/server/internal/auth"
)

const (
	mcpDefaultPageSize = 20
	// An agent edit is built on the latest body and written with a version
	// guard. When the owner is typing, autosave can move the version between
	// the read and the write, so the edit is rebuilt a few times before it
	// gives up.
	mcpWriteAttempts = 3
)

// MCPOptions holds what the MCP tools need from outside this package.
type MCPOptions struct {
	// AppBaseURL turns a document's public ID into a link the owner can open.
	// Empty leaves links out.
	AppBaseURL string
	// MaxSavedDocs reports the owner's saved document limit when an agent
	// creates a document.
	MaxSavedDocs func(context.Context) (int, error)
	// Allow charges the owner's abuse limits. kind is "search" or "mutation",
	// matching the REST routes. Reads are not limited, as on the REST routes.
	Allow func(ctx context.Context, kind string) error
}

// MCPServer builds an MCP server whose tools act as user, attributed to
// actor. It is built per request, after authentication, so no tool can reach
// another account's documents.
func (h *Handler) MCPServer(user auth.User, actor Actor, opts MCPOptions) *mcp.Server {
	t := &mcpTools{store: h.store, ownerID: user.ID, actor: actor, opts: opts}
	server := mcp.NewServer(&mcp.Implementation{Name: "passage", Title: "Passage"}, &mcp.ServerOptions{
		Instructions: "Passage holds the user's private Markdown documents. " +
			"Search or list to find a document, read it before changing it, and prefer edit_document " +
			"for small changes so the rest of the document stays exactly as the user wrote it.",
	})
	mcp.AddTool(server, &mcp.Tool{
		Name:        "search_documents",
		Description: "Full-text search over the user's documents. Title matches rank first. Supports quoted phrases and -exclusions. Returns ids, titles and a short excerpt around each match.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.search)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_documents",
		Description: "List the user's documents, most recently updated first. Returns ids and titles, not bodies. Pass nextCursor back to get the next page.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.list)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "read_document",
		Description: "Read one document's full Markdown body.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, t.read)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_document",
		Description: "Create a new private document from Markdown. The first line becomes the title, so start with a heading.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: ptr(false)},
	}, t.create)
	mcp.AddTool(server, &mcp.Tool{
		Name: "edit_document",
		Description: "Replace one exact passage in a document. oldText must appear exactly once in the current body, " +
			"including whitespace and Markdown; include more surrounding text if it is not unique. Everything else is left untouched.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: ptr(false)},
	}, t.edit)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "append_to_document",
		Description: "Add Markdown to the end of a document, separated from the existing text by a blank line.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: ptr(false)},
	}, t.appendTo)
	return server
}

func ptr[T any](value T) *T { return &value }

type mcpTools struct {
	store   documentStore
	ownerID string
	actor   Actor
	opts    MCPOptions
}

type mcpDocumentSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Excerpt   string    `json:"excerpt,omitempty"`
	URL       string    `json:"url,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type mcpDocument struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	URL       string    `json:"url,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type mcpWriteResult struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url,omitempty"`
}

type mcpSearchInput struct {
	Query string `json:"query" jsonschema:"words or quoted phrases to search for"`
	Limit int    `json:"limit,omitempty" jsonschema:"maximum results, 1 to 50, default 20"`
}

type mcpSearchOutput struct {
	Documents []mcpDocumentSummary `json:"documents"`
}

func (t *mcpTools) search(ctx context.Context, _ *mcp.CallToolRequest, in mcpSearchInput) (*mcp.CallToolResult, mcpSearchOutput, error) {
	query, err := normalizeSearchQuery(in.Query)
	if err != nil {
		return nil, mcpSearchOutput{}, errors.New(strings.Replace(err.Error(), "q ", "query ", 1))
	}
	limit, err := mcpLimit(in.Limit, 50)
	if err != nil {
		return nil, mcpSearchOutput{}, err
	}
	if err := t.allow(ctx, "search"); err != nil {
		return nil, mcpSearchOutput{}, err
	}
	results, err := t.store.Search(ctx, t.ownerID, query, limit, nil)
	if errors.Is(err, ErrEmptySearchQuery) {
		return nil, mcpSearchOutput{}, errors.New("query has no searchable terms")
	}
	if err != nil {
		return nil, mcpSearchOutput{}, t.internal(ctx, "search documents", err)
	}
	out := mcpSearchOutput{Documents: []mcpDocumentSummary{}}
	for _, result := range results {
		out.Documents = append(out.Documents, mcpDocumentSummary{
			ID:        result.ID,
			Title:     result.Title,
			Excerpt:   result.MatchExcerpt,
			URL:       t.url(result.PublicID),
			UpdatedAt: result.UpdatedAt,
		})
	}
	return nil, out, nil
}

type mcpListInput struct {
	Cursor string `json:"cursor,omitempty" jsonschema:"nextCursor from a previous call"`
	Limit  int    `json:"limit,omitempty" jsonschema:"maximum documents, 1 to 100, default 20"`
}

type mcpListOutput struct {
	Documents  []mcpDocumentSummary `json:"documents"`
	NextCursor string               `json:"nextCursor,omitempty"`
}

func (t *mcpTools) list(ctx context.Context, _ *mcp.CallToolRequest, in mcpListInput) (*mcp.CallToolResult, mcpListOutput, error) {
	limit, err := mcpLimit(in.Limit, maxDocumentPageSize)
	if err != nil {
		return nil, mcpListOutput{}, err
	}
	cursor, err := decodeListCursor(in.Cursor)
	if err != nil {
		return nil, mcpListOutput{}, errors.New("invalid cursor")
	}
	docs, err := t.store.ListPage(ctx, t.ownerID, limit+1, cursor)
	if err != nil {
		return nil, mcpListOutput{}, t.internal(ctx, "list documents", err)
	}
	out := mcpListOutput{Documents: []mcpDocumentSummary{}}
	if len(docs) > limit {
		docs = docs[:limit]
		last := docs[len(docs)-1]
		out.NextCursor = encodeListCursor(ListCursor{UpdatedAt: last.UpdatedAt, ID: last.ID})
	}
	for _, doc := range docs {
		out.Documents = append(out.Documents, mcpDocumentSummary{
			ID:        doc.ID,
			Title:     doc.Title,
			URL:       t.url(doc.PublicID),
			UpdatedAt: doc.UpdatedAt,
		})
	}
	return nil, out, nil
}

type mcpIDInput struct {
	ID string `json:"id" jsonschema:"the document id"`
}

func (t *mcpTools) read(ctx context.Context, _ *mcp.CallToolRequest, in mcpIDInput) (*mcp.CallToolResult, mcpDocument, error) {
	doc, err := t.get(ctx, in.ID)
	if err != nil {
		return nil, mcpDocument{}, err
	}
	return nil, mcpDocument{
		ID:        doc.ID,
		Title:     doc.Title,
		Body:      doc.Body,
		URL:       t.url(doc.PublicID),
		UpdatedAt: doc.UpdatedAt,
	}, nil
}

type mcpCreateInput struct {
	Markdown string `json:"markdown" jsonschema:"the document body in Markdown"`
}

func (t *mcpTools) create(ctx context.Context, _ *mcp.CallToolRequest, in mcpCreateInput) (*mcp.CallToolResult, mcpWriteResult, error) {
	if strings.TrimSpace(in.Markdown) == "" {
		return nil, mcpWriteResult{}, errors.New("markdown is empty")
	}
	if err := checkBodySize(in.Markdown); err != nil {
		return nil, mcpWriteResult{}, err
	}
	if err := t.allow(ctx, "mutation"); err != nil {
		return nil, mcpWriteResult{}, err
	}
	maxSavedDocs := NoSavedDocumentLimit
	if t.opts.MaxSavedDocs != nil {
		limit, err := t.opts.MaxSavedDocs(ctx)
		if err != nil {
			return nil, mcpWriteResult{}, t.internal(ctx, "load document account", err)
		}
		maxSavedDocs = limit
	}
	doc, err := t.store.Create(ctx, t.ownerID, in.Markdown, "", maxSavedDocs, t.actor)
	if errors.Is(err, ErrLimitReached) {
		return nil, mcpWriteResult{}, errors.New("saved document limit reached")
	}
	if err != nil {
		return nil, mcpWriteResult{}, t.internal(ctx, "create document", err)
	}
	return nil, t.written(doc), nil
}

type mcpEditInput struct {
	ID      string `json:"id" jsonschema:"the document id"`
	OldText string `json:"oldText" jsonschema:"the exact passage to replace; must appear once"`
	NewText string `json:"newText" jsonschema:"the replacement text; empty deletes the passage"`
}

func (t *mcpTools) edit(ctx context.Context, _ *mcp.CallToolRequest, in mcpEditInput) (*mcp.CallToolResult, mcpWriteResult, error) {
	if in.OldText == "" {
		return nil, mcpWriteResult{}, errors.New("oldText is empty")
	}
	return t.rewrite(ctx, in.ID, func(body string) (string, error) {
		switch count := strings.Count(body, in.OldText); count {
		case 0:
			return "", errors.New("oldText was not found in the document; read it again and copy the passage exactly")
		case 1:
			return strings.Replace(body, in.OldText, in.NewText, 1), nil
		default:
			return "", fmt.Errorf("oldText appears %d times; include more surrounding text so it matches once", count)
		}
	})
}

type mcpAppendInput struct {
	ID       string `json:"id" jsonschema:"the document id"`
	Markdown string `json:"markdown" jsonschema:"the Markdown to add at the end"`
}

func (t *mcpTools) appendTo(ctx context.Context, _ *mcp.CallToolRequest, in mcpAppendInput) (*mcp.CallToolResult, mcpWriteResult, error) {
	addition := strings.Trim(in.Markdown, "\n")
	if strings.TrimSpace(addition) == "" {
		return nil, mcpWriteResult{}, errors.New("markdown is empty")
	}
	return t.rewrite(ctx, in.ID, func(body string) (string, error) {
		trimmed := strings.TrimRight(body, "\n")
		if trimmed == "" {
			return addition + "\n", nil
		}
		return trimmed + "\n\n" + addition + "\n", nil
	})
}

// rewrite applies change to the latest body and writes it only if nobody else
// wrote in between. Because change always runs on what is stored now, a
// passage the owner just typed is never replaced by an agent's stale copy.
func (t *mcpTools) rewrite(ctx context.Context, id string, change func(string) (string, error)) (*mcp.CallToolResult, mcpWriteResult, error) {
	if err := t.allow(ctx, "mutation"); err != nil {
		return nil, mcpWriteResult{}, err
	}
	for attempt := 0; attempt < mcpWriteAttempts; attempt++ {
		doc, err := t.get(ctx, id)
		if err != nil {
			return nil, mcpWriteResult{}, err
		}
		body, err := change(doc.Body)
		if err != nil {
			return nil, mcpWriteResult{}, err
		}
		if err := checkBodySize(body); err != nil {
			return nil, mcpWriteResult{}, err
		}
		version := doc.Version
		updated, err := t.store.Update(ctx, t.ownerID, doc.ID, DocumentUpdate{Body: &body, IfVersion: &version, Actor: t.actor})
		if errors.Is(err, ErrVersionConflict) {
			continue
		}
		if errors.Is(err, ErrNotFound) {
			return nil, mcpWriteResult{}, errors.New("document not found")
		}
		if err != nil {
			return nil, mcpWriteResult{}, t.internal(ctx, "update document", err)
		}
		return nil, t.written(updated), nil
	}
	return nil, mcpWriteResult{}, errors.New("the document kept changing while saving; read it again and retry")
}

func (t *mcpTools) get(ctx context.Context, id string) (Document, error) {
	if !validUUID(id) {
		return Document{}, errors.New("document not found")
	}
	doc, err := t.store.Get(ctx, t.ownerID, id)
	if errors.Is(err, ErrNotFound) {
		return Document{}, errors.New("document not found")
	}
	if err != nil {
		return Document{}, t.internal(ctx, "get document", err)
	}
	return doc, nil
}

func (t *mcpTools) allow(ctx context.Context, kind string) error {
	if t.opts.Allow == nil {
		return nil
	}
	return t.opts.Allow(ctx, kind)
}

func (t *mcpTools) written(doc Document) mcpWriteResult {
	return mcpWriteResult{ID: doc.ID, Title: doc.Title, URL: t.url(doc.PublicID)}
}

func (t *mcpTools) url(publicID string) string {
	if t.opts.AppBaseURL == "" || publicID == "" {
		return ""
	}
	return strings.TrimRight(t.opts.AppBaseURL, "/") + "/write/" + publicID
}

// internal logs the cause and hands the agent a message without server detail.
func (t *mcpTools) internal(ctx context.Context, operation string, err error) error {
	slog.ErrorContext(ctx, "mcp tool failed", "operation", operation, "error", err)
	return errors.New("something went wrong in Passage; try again")
}

func mcpLimit(value int, max int) (int, error) {
	if value == 0 {
		return min(mcpDefaultPageSize, max), nil
	}
	if value < 1 || value > max {
		return 0, fmt.Errorf("limit must be between 1 and %d", max)
	}
	return value, nil
}

func checkBodySize(body string) error {
	if len(body) > MaxDocumentBodyBytes {
		return errors.New("document body is too large")
	}
	return nil
}
