package server

import (
	"net/http"
	"net/url"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/documents"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

func (a *App) listAPITokens(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.allowUserRequest(w, r, a.rateLimiters.apiToken, user.ID) {
			return
		}
		a.auth.ListAPITokens(w, r, user)
	})(w, r)
}

func (a *App) createAPIToken(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.allowUserRequest(w, r, a.rateLimiters.apiToken, user.ID) {
			return
		}
		if !a.requirePro(w, r, user) {
			return
		}
		a.auth.CreateAPIToken(w, r, user)
	})(w, r)
}

func (a *App) revokeAPIToken(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.allowUserRequest(w, r, a.rateLimiters.apiToken, user.ID) {
			return
		}
		a.auth.RevokeAPIToken(w, r, user)
	})(w, r)
}

func (a *App) listDocs(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.List)(w, r)
}

func (a *App) searchDocs(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.allowUserRequest(w, r, a.rateLimiters.documentSearch, user.ID) {
			return
		}
		a.docs.Search(w, r, user)
	})(w, r)
}

func (a *App) createDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocumentMutation(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		maxSavedDocs := documents.NoSavedDocumentLimit
		if a.billing != nil {
			account, err := a.billing.Account(r.Context(), user)
			if err != nil {
				httpx.WriteInternalError(w, r, "load document account", err, "account could not be loaded")
				return
			}
			maxSavedDocs = account.Limits.MaxSavedDocs
		}
		a.docs.Create(w, r, user, maxSavedDocs)
	})(w, r)
}

func (a *App) getDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.Get)(w, r)
}

func (a *App) updateDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocumentMutation(a.docs.Update)(w, r)
}

func (a *App) archiveDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocumentMutation(a.docs.Archive)(w, r)
}

func (a *App) shareDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocumentMutation(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requirePro(w, r, user) {
			return
		}
		a.docs.Share(w, r, user)
	})(w, r)
}

func (a *App) unshareDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocumentMutation(a.docs.Unshare)(w, r)
}

func (a *App) publicDoc(w http.ResponseWriter, r *http.Request) {
	if a.docs == nil {
		http.NotFound(w, r)
		return
	}
	a.docs.Public(w, r)
}

func (a *App) write(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		redirectToLogin(w, r)
		return
	}
	if _, ok := a.auth.UserFromSessionRequest(r); !ok {
		redirectToLogin(w, r)
		return
	}
	serveFile(w, r, a.static, "write.html")
}

func redirectToLogin(w http.ResponseWriter, r *http.Request) {
	next := r.URL.RequestURI()
	if next == "" {
		next = "/write"
	}
	http.Redirect(w, r, "/login?next="+url.QueryEscape(next), http.StatusFound)
}

func (a *App) requireDocumentService(w http.ResponseWriter) bool {
	if a.auth == nil || a.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) requireUserForDocs(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if user, ok := a.auth.UserFromSessionRequest(r); ok {
			next(w, r, user)
			return
		}
		// Resolve the bearer token once and carry the actor on the request.
		// Looking it up a second time to attribute the write would charge
		// another round trip and, on a transient failure, quietly credit an
		// agent's change to the account owner.
		if actor, ok := a.auth.ActorFromBearerRequest(r); ok {
			if !a.requirePro(w, r, actor.User) {
				return
			}
			next(w, r.WithContext(documents.WithActor(r.Context(), documents.Actor{
				TokenID:   actor.TokenID,
				TokenName: actor.TokenName,
			})), actor.User)
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
}

func (a *App) requireUserForDocumentMutation(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return a.requireUserForDocs(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.allowUserRequest(w, r, a.rateLimiters.documentMutation, user.ID) {
			return
		}
		next(w, r, user)
	})
}
