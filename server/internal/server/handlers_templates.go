package server

import (
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

func (a *App) listTemplates(w http.ResponseWriter, r *http.Request) {
	if !a.requireTemplateService(w) {
		return
	}
	a.auth.RequireSessionUser(a.templates.List)(w, r)
}

func (a *App) createTemplate(w http.ResponseWriter, r *http.Request) {
	if !a.requireTemplateService(w) {
		return
	}
	a.requireUserForTemplateMutation(a.templates.Create)(w, r)
}

func (a *App) getTemplate(w http.ResponseWriter, r *http.Request) {
	if !a.requireTemplateService(w) {
		return
	}
	a.auth.RequireSessionUser(a.templates.Get)(w, r)
}

func (a *App) updateTemplate(w http.ResponseWriter, r *http.Request) {
	if !a.requireTemplateService(w) {
		return
	}
	a.requireUserForTemplateMutation(a.templates.Update)(w, r)
}

func (a *App) deleteTemplate(w http.ResponseWriter, r *http.Request) {
	if !a.requireTemplateService(w) {
		return
	}
	a.requireUserForTemplateMutation(a.templates.Delete)(w, r)
}

func (a *App) requireTemplateService(w http.ResponseWriter) bool {
	if a.auth == nil || a.templates == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) requireUserForTemplateMutation(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.allowUserRequest(w, r, a.rateLimiters.documentMutation, user.ID) {
			return
		}
		next(w, r, user)
	})
}
