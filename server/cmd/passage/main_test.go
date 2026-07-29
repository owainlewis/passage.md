package main

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/accountdata"
	"github.com/owainlewis/passage.md/server/internal/config"
)

func TestServeRequiresDatabaseURL(t *testing.T) {
	err := serve(config.Config{
		SessionSecret: "test-secret",
	})

	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() != "DATABASE_URL is required" {
		t.Fatalf("error = %q", err)
	}
}

func TestWriteFenceBlocksMutationCommands(t *testing.T) {
	t.Setenv("PASSAGE_WRITES_DISABLED", "true")

	for _, args := range [][]string{
		{"migrate"},
		{"user", "user@example.com"},
		{"account", "delete", "user@example.com", "--confirm", "user@example.com"},
		{"account", "cleanup-stripe", "cus_pending"},
		{"community", "referral", "create", "launch-test", "Launch test", "--code-sha256", strings.Repeat("a", 64)},
		{"community", "referral", "disable", "launch-test"},
		{"community", "grant", "revoke", "user@example.com", "--reason", "launch test complete"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			err := run(append([]string{"passage"}, args...))
			if err == nil || !strings.Contains(err.Error(), "disabled while PASSAGE_WRITES_DISABLED is enabled") {
				t.Fatalf("run error = %v", err)
			}
		})
	}
}

func TestCommunityCommandsRequireDatabaseWithoutEchoingCodeHash(t *testing.T) {
	codeHash := strings.Repeat("a1", 32)
	err := run([]string{"passage", "community", "referral", "create", "launch-test", "Launch test", "--code-sha256", codeHash})
	if err == nil || err.Error() != "DATABASE_URL is required" {
		t.Fatalf("run error = %v", err)
	}
	if strings.Contains(err.Error(), codeHash) {
		t.Fatal("error exposed the referral code hash")
	}
}

func TestWriteFenceAllowsAccountExportCommand(t *testing.T) {
	t.Setenv("PASSAGE_WRITES_DISABLED", "true")

	err := run([]string{"passage", "account", "export", "user@example.com", "account.zip"})
	if err == nil || err.Error() != "DATABASE_URL is required" {
		t.Fatalf("run error = %v, want DATABASE_URL requirement after fence allows export", err)
	}
}

func TestHTTPServerHasProductionTimeouts(t *testing.T) {
	server := newHTTPServer("9090", http.NotFoundHandler())
	if server.Addr != ":9090" {
		t.Fatalf("addr = %q", server.Addr)
	}
	if server.ReadHeaderTimeout != 5*time.Second || server.ReadTimeout != 15*time.Second || server.WriteTimeout != 30*time.Second || server.IdleTimeout != 60*time.Second {
		t.Fatalf("timeouts = header %s, read %s, write %s, idle %s", server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout)
	}
}

func TestCleanupStripeCustomerResultDoesNotReportMissingJobAsComplete(t *testing.T) {
	err := cleanupStripeCustomerResult("cus_typo", accountdata.ErrStripeCleanupNotPending)
	if err == nil {
		t.Fatal("cleanup result error = nil")
	}
	if got := err.Error(); got != "no matching pending Stripe cleanup job: cus_typo" {
		t.Fatalf("cleanup result error = %q", got)
	}

	stripeErr := errors.New("Stripe unavailable")
	err = cleanupStripeCustomerResult("cus_pending", stripeErr)
	if !errors.Is(err, stripeErr) {
		t.Fatalf("cleanup result error = %v, want Stripe error", err)
	}
}
