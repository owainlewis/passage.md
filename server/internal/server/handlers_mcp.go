package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/owainlewis/passage.md/server/internal/documents"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

// mcpEndpoint serves the Model Context Protocol over Streamable HTTP so agents
// can search, read and write the owner's documents with an API token.
//
// It only accepts bearer tokens. A browser session cookie would let any page
// the owner visits drive the tools, and the endpoint has no same-origin check.
func (a *App) mcpEndpoint(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	actor, ok := a.auth.ActorFromBearerRequest(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="passage"`)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	if !a.requirePro(w, r, actor.User) {
		return
	}
	user := actor.User
	server := a.docs.MCPServer(user, documents.Actor{TokenID: actor.TokenID, TokenName: actor.TokenName}, documents.MCPOptions{
		AppBaseURL: a.appBaseURL,
		MaxSavedDocs: func(ctx context.Context) (int, error) {
			if a.billing == nil {
				return documents.NoSavedDocumentLimit, nil
			}
			account, err := a.billing.Account(ctx, user)
			if err != nil {
				return 0, err
			}
			return account.Limits.MaxSavedDocs, nil
		},
		Allow: func(ctx context.Context, kind string) error {
			limiter := a.rateLimiters.documentMutation
			if kind == "search" {
				limiter = a.rateLimiters.documentSearch
			}
			allowed, retryAfter, err := limiter.allowContext(ctx, user.ID)
			if err != nil {
				httpx.LogError(r, "check abuse rate limit", err)
				return errors.New("rate limit service unavailable; try again shortly")
			}
			if !allowed {
				return fmt.Errorf("rate limit exceeded; retry in %d seconds", int64(math.Max(1, math.Ceil(retryAfter.Seconds()))))
			}
			return nil
		},
	})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
	})
	handler.ServeHTTP(w, r)
}
