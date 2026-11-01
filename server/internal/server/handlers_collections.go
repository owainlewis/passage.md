package server

import (
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

// Collections were removed: every document lives in one list. Older CLI
// releases and agents still call these routes, so listing answers with no
// collections and every change explains why it no longer applies, instead
// of a bare 404.

func (a *App) listCollections(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(func(w http.ResponseWriter, _ *http.Request, _ auth.User) {
		writeJSON(w, http.StatusOK, map[string][]struct{}{"collections": {}})
	})(w, r)
}

func (a *App) collectionsRemoved(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusGone, map[string]string{"error": "collections have been removed; every document is in one list"})
}
