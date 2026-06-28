package config

import "testing"

func TestFromEnvDefaultsPort(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("STATIC_DIR", "apps/web/out")

	cfg := FromEnv()
	if cfg.Port != "8080" {
		t.Fatalf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.DatabaseURL != "postgres://example" {
		t.Fatalf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.StaticDir != "apps/web/out" {
		t.Fatalf("StaticDir = %q", cfg.StaticDir)
	}
}
