package server

import (
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

func (a *App) listCollections(w http.ResponseWriter, r *http.Request) {
	if !a.requireCollectionService(w) {
		return
	}
	a.requireUserForDocs(a.collections.List)(w, r)
}

func (a *App) createCollection(w http.ResponseWriter, r *http.Request) {
	if !a.requireCollectionService(w) {
		return
	}
	a.requireUserForCollectionMutation(a.collections.Create)(w, r)
}

func (a *App) updateCollection(w http.ResponseWriter, r *http.Request) {
	if !a.requireCollectionService(w) {
		return
	}
	a.requireUserForCollectionMutation(a.collections.Update)(w, r)
}

func (a *App) deleteCollection(w http.ResponseWriter, r *http.Request) {
	if !a.requireCollectionService(w) {
		return
	}
	a.requireUserForCollectionMutation(a.collections.Delete)(w, r)
}

func (a *App) requireCollectionService(w http.ResponseWriter) bool {
	if a.auth == nil || a.collections == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) requireUserForCollectionMutation(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return a.requireUserForDocumentMutation(next)
}
