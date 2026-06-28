package config

import "testing"

func TestFromEnvDefaultsPort(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("STATIC_DIR", "apps/web/out")
	t.Setenv("SESSION_SECRET", "")
	t.Setenv("APP_ENV", "")

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
	if cfg.SessionSecret == "" {
		t.Fatal("SessionSecret is empty")
	}
	if cfg.CookieSecure {
		t.Fatal("CookieSecure = true, want false")
	}
}

func TestFromEnvRequiresExplicitProductionSessionSecret(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("SESSION_SECRET", "")

	cfg := FromEnv()
	if cfg.SessionSecret != "" {
		t.Fatalf("SessionSecret = %q, want empty", cfg.SessionSecret)
	}
	if !cfg.CookieSecure {
		t.Fatal("CookieSecure = false, want true")
	}
}
