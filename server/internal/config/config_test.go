package config

import "testing"

func TestFromEnvDefaultsPort(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("STATIC_DIR", "apps/web/out")
	t.Setenv("SESSION_SECRET", "")
	t.Setenv("APP_ENV", "")

	cfg := FromEnv()
	if cfg.AppEnv != "" {
		t.Fatalf("AppEnv = %q, want empty", cfg.AppEnv)
	}
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

func TestValidateServeAllowsProductionWithoutStripeWhenBillingDisabled(t *testing.T) {
	cfg := Config{
		AppEnv:        "production",
		DatabaseURL:   "postgres://example",
		SessionSecret: "secret",
		Billing: BillingConfig{
			StripeBillingEnabled: false,
			AppBaseURL:           "http://localhost:8080",
		},
	}

	if err := cfg.ValidateServe(); err != nil {
		t.Fatalf("ValidateServe = %v", err)
	}
}

func TestValidateServeRequiresStripeConfigWhenBillingEnabled(t *testing.T) {
	cfg := Config{
		AppEnv:        "production",
		DatabaseURL:   "postgres://example",
		SessionSecret: "secret",
		Billing: BillingConfig{
			StripeBillingEnabled: true,
			StripeSecretKey:      "sk_live_test",
			StripeMonthlyPrice:   "price_1TpAeQRiiEo9jrWNlLdI9HwB",
			StripeWebhookSecret:  "whsec_live_test",
			AppBaseURL:           "https://passage.md",
		},
	}

	err := cfg.ValidateServe()
	if err == nil || err.Error() != "STRIPE_MONTHLY_PRICE_ID must be set explicitly when Stripe billing is enabled" {
		t.Fatalf("ValidateServe error = %v", err)
	}

	cfg.Billing.StripeMonthlyPrice = "price_live_123"
	cfg.Billing.AppBaseURL = "http://localhost:8080"
	err = cfg.ValidateServe()
	if err == nil || err.Error() != "APP_BASE_URL must be set to the production URL when Stripe billing is enabled" {
		t.Fatalf("ValidateServe localhost error = %v", err)
	}

	cfg.Billing.AppBaseURL = "https://passage.md"
	if err := cfg.ValidateServe(); err != nil {
		t.Fatalf("ValidateServe = %v", err)
	}
}

func TestFromEnvEnablesStripeBillingExplicitly(t *testing.T) {
	t.Setenv("STRIPE_BILLING_ENABLED", "true")

	cfg := FromEnv()
	if !cfg.Billing.StripeBillingEnabled {
		t.Fatal("StripeBillingEnabled = false, want true")
	}
}
