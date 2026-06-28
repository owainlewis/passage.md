package server

import (
	"encoding/json"
	"io/fs"
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

type Options struct {
	SessionSecret string
	CookieSecure  bool
}

type App struct {
	static fs.FS
	db     *database.Pool
	auth   *auth.Service
	docs   *documents.Handler
}

func NewApp(static fs.FS, db *database.Pool, opts ...Options) *App {
	var options Options
	if len(opts) > 0 {
		options = opts[0]
	}
	if options.SessionSecret == "" {
		options.SessionSecret = "dev-session-secret-change-me"
	}
	app := &App{static: static, db: db}
	if db != nil {
		app.auth = auth.NewService(auth.NewPGStore(db), options.SessionSecret, options.CookieSecure)
		app.docs = documents.NewHandler(documents.NewStore(db))
	}
	return app
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/v1/me", a.me)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("GET /api/v1/docs", a.listDocs)
	mux.HandleFunc("POST /api/v1/docs", a.createDoc)
	mux.HandleFunc("GET /api/v1/docs/{id}", a.getDoc)
	mux.HandleFunc("PATCH /api/v1/docs/{id}", a.updateDoc)
	mux.HandleFunc("DELETE /api/v1/docs/{id}", a.archiveDoc)
	mux.Handle("/", StaticHandler(a.static))
	return mux
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	status := "not_configured"
	if a.db != nil {
		status = "ok"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":   "ok",
		"database": status,
	})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
		return
	}
	a.auth.Me(w, r)
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.Register(w, r)
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.Login(w, r)
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		http.SetCookie(w, &http.Cookie{
			Name:     auth.CookieName,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	a.auth.Logout(w, r)
}

func (a *App) requireAuthService(w http.ResponseWriter) bool {
	if a.auth == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) listDocs(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.auth.RequireUser(a.docs.List)(w, r)
}

func (a *App) createDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.auth.RequireUser(a.docs.Create)(w, r)
}

func (a *App) getDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.auth.RequireUser(a.docs.Get)(w, r)
}

func (a *App) updateDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.auth.RequireUser(a.docs.Update)(w, r)
}

func (a *App) archiveDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.auth.RequireUser(a.docs.Archive)(w, r)
}

func (a *App) requireDocumentService(w http.ResponseWriter) bool {
	if a.auth == nil || a.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
