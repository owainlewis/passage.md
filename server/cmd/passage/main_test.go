package main

import (
	"net/http"
	"testing"
	"time"

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

func TestHTTPServerHasProductionTimeouts(t *testing.T) {
	server := newHTTPServer("9090", http.NotFoundHandler())
	if server.Addr != ":9090" {
		t.Fatalf("addr = %q", server.Addr)
	}
	if server.ReadHeaderTimeout != 5*time.Second || server.ReadTimeout != 15*time.Second || server.WriteTimeout != 30*time.Second || server.IdleTimeout != 60*time.Second {
		t.Fatalf("timeouts = header %s, read %s, write %s, idle %s", server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout)
	}
}
