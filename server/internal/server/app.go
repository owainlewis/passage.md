package server

import (
	"encoding/json"
	"io/fs"
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/database"
)

type App struct {
	static fs.FS
	db     *database.Pool
}

func NewApp(static fs.FS, db *database.Pool) *App {
	return &App{static: static, db: db}
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
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

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
