package config

import (
	"testing"
	"time"
)

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
		PasswordReset: PasswordResetConfig{
			AppBaseURL:   "https://passage.md",
			ResendAPIKey: "re_secret",
			ResendFrom:   "passage.md <mail@passage.md>",
		},
		Billing: BillingConfig{
			StripeBillingEnabled: false,
			AppBaseURL:           "http://localhost:8080",
		},
	}

	if err := cfg.ValidateServe(); err != nil {
		t.Fatalf("ValidateServe = %v", err)
	}
}

func TestValidateServeRequiresPasswordResetEmailInProduction(t *testing.T) {
	cfg := Config{
		AppEnv:        "production",
		DatabaseURL:   "postgres://example",
		SessionSecret: "secret",
		PasswordReset: PasswordResetConfig{AppBaseURL: "https://passage.md"},
	}
	if err := cfg.ValidateServe(); err == nil || err.Error() != "RESEND_API_KEY and RESEND_FROM are required in production" {
		t.Fatalf("ValidateServe error = %v", err)
	}
}

func TestValidateServeRequiresStripeConfigWhenBillingEnabled(t *testing.T) {
	cfg := Config{
		AppEnv:        "production",
		DatabaseURL:   "postgres://example",
		SessionSecret: "secret",
		PasswordReset: PasswordResetConfig{
			AppBaseURL:   "https://passage.md",
			ResendAPIKey: "re_secret",
			ResendFrom:   "passage.md <mail@passage.md>",
		},
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

func TestFromEnvEnablesWriteFenceExplicitly(t *testing.T) {
	t.Setenv("PASSAGE_WRITES_DISABLED", "true")

	cfg := FromEnv()
	if !cfg.WritesDisabled {
		t.Fatal("WritesDisabled = false, want true")
	}
}

func TestFromEnvLeavesWriteFenceDisabledByDefault(t *testing.T) {
	t.Setenv("PASSAGE_WRITES_DISABLED", "")

	cfg := FromEnv()
	if cfg.WritesDisabled {
		t.Fatal("WritesDisabled = true, want false")
	}
}

func TestFromEnvLoadsPasswordResetConfiguration(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://passage.md")
	t.Setenv("RESEND_API_KEY", " re_secret ")
	t.Setenv("RESEND_FROM", " passage.md <mail@passage.md> ")

	cfg := FromEnv()
	if cfg.PasswordReset.AppBaseURL != "https://passage.md" || cfg.PasswordReset.ResendAPIKey != "re_secret" || cfg.PasswordReset.ResendFrom != "passage.md <mail@passage.md>" {
		t.Fatalf("password reset config = %#v", cfg.PasswordReset)
	}
	if !cfg.PasswordReset.ResendConfigured() {
		t.Fatal("ResendConfigured = false, want true")
	}
}

func TestFromEnvLoadsRateLimitAndProductionProxyDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("PASSAGE_RATE_LIMIT_AUTH_REQUESTS", "7")
	t.Setenv("PASSAGE_RATE_LIMIT_AUTH_WINDOW", "30s")

	cfg := FromEnv()
	if cfg.RateLimits.AuthMutation.Requests != 7 || cfg.RateLimits.AuthMutation.Window != 30*time.Second {
		t.Fatalf("auth rate limit = %#v", cfg.RateLimits.AuthMutation)
	}
	if cfg.RateLimits.DocumentMutation.Requests != 120 || cfg.RateLimits.DocumentMutation.Window != time.Minute {
		t.Fatalf("document mutation rate limit = %#v", cfg.RateLimits.DocumentMutation)
	}
	if cfg.Proxy.ForwardedHops != 2 || len(cfg.Proxy.TrustedCIDRs) == 0 {
		t.Fatalf("proxy config = %#v", cfg.Proxy)
	}
}

func TestValidateServeRejectsUnsafeProxyConfiguration(t *testing.T) {
	cfg := Config{
		DatabaseURL:   "postgres://example",
		SessionSecret: "secret",
		Proxy:         ProxyConfig{ForwardedHops: 2},
	}
	if err := cfg.ValidateServe(); err == nil || err.Error() != "PASSAGE_TRUSTED_PROXY_CIDRS is required when PASSAGE_FORWARDED_HOPS is greater than zero" {
		t.Fatalf("ValidateServe error = %v", err)
	}

	cfg.Proxy.TrustedCIDRs = []string{"not-a-cidr"}
	if err := cfg.ValidateServe(); err == nil || err.Error() != "PASSAGE_TRUSTED_PROXY_CIDRS contains an invalid CIDR" {
		t.Fatalf("ValidateServe CIDR error = %v", err)
	}
}

func TestValidateServeRejectsPartialPasswordResetConfiguration(t *testing.T) {
	cfg := Config{
		DatabaseURL:   "postgres://example",
		SessionSecret: "secret",
		PasswordReset: PasswordResetConfig{ResendAPIKey: "re_secret", AppBaseURL: "https://passage.md"},
	}
	if err := cfg.ValidateServe(); err == nil || err.Error() != "RESEND_API_KEY and RESEND_FROM must be set together" {
		t.Fatalf("ValidateServe error = %v", err)
	}

	cfg.PasswordReset.ResendFrom = "passage.md <mail@passage.md>"
	cfg.AppEnv = "production"
	cfg.PasswordReset.AppBaseURL = "http://localhost:8080"
	if err := cfg.ValidateServe(); err == nil || err.Error() != "APP_BASE_URL must be set to the production URL when password reset email is enabled" {
		t.Fatalf("ValidateServe production error = %v", err)
	}
}
