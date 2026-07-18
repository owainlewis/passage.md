package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const SmallJSONBodyBytes int64 = 16 * 1024

func RequireJSONMutation(w http.ResponseWriter, r *http.Request, maxBytes int64) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return false
	}
	if !RequireSameOrigin(w, r) {
		return false
	}
	if r.ContentLength > maxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "request body is too large")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	return true
}

func RequireSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if origin != requestScheme(r)+"://"+r.Host {
		writeError(w, http.StatusForbidden, "cross-origin requests are not allowed")
		return false
	}
	return true
}

func DecodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		writeDecodeError(w, err)
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeDecodeError(w, err)
		return false
	}
	return true
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		writeError(w, http.StatusRequestEntityTooLarge, "request body is too large")
		return
	}
	writeError(w, http.StatusBadRequest, "invalid JSON")
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" || proto == "http" {
		return proto
	}
	return "http"
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
