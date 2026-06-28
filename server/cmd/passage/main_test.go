package main

import (
	"testing"

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
