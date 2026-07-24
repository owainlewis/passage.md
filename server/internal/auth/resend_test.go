package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResendSenderSendsExpectedRequest(t *testing.T) {
	var authorization string
	var idempotencyKey string
	var payload struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
		Text    string   `json:"text"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		idempotencyKey = r.Header.Get("Idempotency-Key")
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"id":"email-id"}`))
	}))
	defer server.Close()

	sender := NewResendSender("re_secret", "passage.md <mail@passage.md>", server.Client())
	sender.apiURL = server.URL
	if err := sender.SendPasswordReset(context.Background(), "person@example.com", "https://passage.md/reset-password#token=secret", "password-reset-request-1"); err != nil {
		t.Fatal(err)
	}
	if authorization != "Bearer re_secret" || idempotencyKey != "password-reset-request-1" {
		t.Fatalf("authorization = %q, idempotency key = %q", authorization, idempotencyKey)
	}
	if payload.From != "passage.md <mail@passage.md>" || len(payload.To) != 1 || payload.To[0] != "person@example.com" || payload.Subject == "" || payload.HTML == "" || payload.Text == "" {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestResendSenderRejectsNonSuccessWithoutLeakingBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "provider details", http.StatusForbidden)
	}))
	defer server.Close()
	sender := NewResendSender("re_secret", "passage.md <mail@passage.md>", server.Client())
	sender.apiURL = server.URL
	if err := sender.SendPasswordReset(context.Background(), "person@example.com", "https://passage.md/reset-password#token=secret", "request-1"); err == nil || err.Error() != "send password reset: resend returned status 403" {
		t.Fatalf("error = %v", err)
	}
}
