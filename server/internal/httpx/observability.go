package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

type requestIDKey struct{}
type traceKey struct{}

// WithRequestContext adds a correlation ID to each request and response.
// Cloud Run's trace ID is reused when present so application and request logs
// can be queried together.
func WithRequestContext(next http.Handler, projectID string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := cloudTraceID(r.Header.Get("X-Cloud-Trace-Context"))
		if requestID == "" {
			requestID = newRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(r.Context(), requestIDKey{}, requestID)
		if projectID != "" && cloudTraceID(r.Header.Get("X-Cloud-Trace-Context")) != "" {
			trace := "projects/" + projectID + "/traces/" + requestID
			ctx = context.WithValue(ctx, traceKey{}, trace)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequestID(r *http.Request) string {
	requestID, _ := r.Context().Value(requestIDKey{}).(string)
	return requestID
}

func LogError(r *http.Request, operation string, err error, attrs ...any) {
	logRequest(r, slog.LevelError, operation, err, attrs...)
}

func LogWarning(r *http.Request, operation string, err error, attrs ...any) {
	logRequest(r, slog.LevelWarn, operation, err, attrs...)
}

func logRequest(r *http.Request, level slog.Level, operation string, err error, attrs ...any) {
	route := r.Pattern
	if route == "" {
		route = r.URL.Path
	}
	fields := []any{
		"request_id", RequestID(r),
		"route", route,
		"operation", operation,
		"error", err,
	}
	if trace, _ := r.Context().Value(traceKey{}).(string); trace != "" {
		fields = append(fields, "logging.googleapis.com/trace", trace)
	}
	fields = append(fields, attrs...)
	slog.Log(r.Context(), level, "request failed", fields...)
}

func WriteInternalError(w http.ResponseWriter, r *http.Request, operation string, err error, message string, attrs ...any) {
	LogError(r, operation, err, attrs...)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func cloudTraceID(header string) string {
	traceID, _, _ := strings.Cut(header, "/")
	if len(traceID) != 32 {
		return ""
	}
	if _, err := hex.DecodeString(traceID); err != nil {
		return ""
	}
	return strings.ToLower(traceID)
}

func newRequestID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "request-id-unavailable"
	}
	return hex.EncodeToString(value[:])
}
