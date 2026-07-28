package server

import (
	"encoding/json"
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/httpx"
)

func writePaymentRequired(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func validateJSONMutation(w http.ResponseWriter, r *http.Request) bool {
	return httpx.RequireJSONMutation(w, r, httpx.SmallJSONBodyBytes)
}

func validateSameOriginMutation(w http.ResponseWriter, r *http.Request) bool {
	return httpx.RequireSameOrigin(w, r)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return httpx.DecodeJSON(w, r, target)
}
