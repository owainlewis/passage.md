package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppEnv        string
	Port          string
	DatabaseURL   string
	StaticDir     string
	SessionSecret string
	CookieSecure  bool
	PasswordReset PasswordResetConfig
	Billing       BillingConfig
}

type PasswordResetConfig struct {
	AppBaseURL   string
	ResendAPIKey string
	ResendFrom   string
}

type BillingConfig struct {
	StripeBillingEnabled bool
	FreeMaxSavedDocs     int
	ProMaxSavedDocs      int
	OwnerEmails          []string
	StripeSecretKey      string
	StripeMonthlyPrice   string
	StripeWebhookSecret  string
	AppBaseURL           string
}

func FromEnv() Config {
	appEnv := os.Getenv("APP_ENV")
	sessionSecret := os.Getenv("SESSION_SECRET")
	appBaseURL := valueOrDefault(os.Getenv("APP_BASE_URL"), "http://localhost:8080")
	if sessionSecret == "" && appEnv != "production" {
		sessionSecret = "dev-session-secret-change-me"
	}
	return Config{
		AppEnv:        appEnv,
		Port:          valueOrDefault(os.Getenv("PORT"), "8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		StaticDir:     os.Getenv("STATIC_DIR"),
		SessionSecret: sessionSecret,
		CookieSecure:  appEnv == "production",
		PasswordReset: PasswordResetConfig{
			AppBaseURL:   appBaseURL,
			ResendAPIKey: strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
			ResendFrom:   strings.TrimSpace(os.Getenv("RESEND_FROM")),
		},
		Billing: BillingConfig{
			StripeBillingEnabled: boolFromEnv(os.Getenv("STRIPE_BILLING_ENABLED")),
			FreeMaxSavedDocs:     intOrDefault(os.Getenv("PASSAGE_FREE_MAX_SAVED_DOCS"), 5),
			ProMaxSavedDocs:      intOrDefault(os.Getenv("PASSAGE_PRO_MAX_SAVED_DOCS"), 1000),
			OwnerEmails:          emailListOrDefault(os.Getenv("PASSAGE_OWNER_EMAILS"), []string{"owain@owainlewis.com"}),
			StripeSecretKey:      os.Getenv("STRIPE_SECRET_KEY"),
			StripeMonthlyPrice:   valueOrDefault(os.Getenv("STRIPE_MONTHLY_PRICE_ID"), "price_1TpAeQRiiEo9jrWNlLdI9HwB"),
			StripeWebhookSecret:  os.Getenv("STRIPE_WEBHOOK_SECRET"),
			AppBaseURL:           appBaseURL,
		},
	}
}

func (c Config) ValidateServe() error {
	if c.SessionSecret == "" {
		return errors.New("SESSION_SECRET is required")
	}
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if c.AppEnv == "production" && !c.PasswordReset.ResendConfigured() {
		return errors.New("RESEND_API_KEY and RESEND_FROM are required in production")
	}
	if (c.PasswordReset.ResendAPIKey == "") != (c.PasswordReset.ResendFrom == "") {
		return errors.New("RESEND_API_KEY and RESEND_FROM must be set together")
	}
	if c.PasswordReset.ResendAPIKey != "" && c.AppEnv == "production" && !validProductionAppBaseURL(c.PasswordReset.AppBaseURL) {
		return errors.New("APP_BASE_URL must be set to the production URL when password reset email is enabled")
	}
	if c.Billing.StripeBillingEnabled {
		if c.Billing.StripeSecretKey == "" {
			return errors.New("STRIPE_SECRET_KEY is required when Stripe billing is enabled")
		}
		if c.Billing.StripeMonthlyPrice == "" || c.Billing.StripeMonthlyPrice == "price_1TpAeQRiiEo9jrWNlLdI9HwB" {
			return errors.New("STRIPE_MONTHLY_PRICE_ID must be set explicitly when Stripe billing is enabled")
		}
		if c.Billing.StripeWebhookSecret == "" {
			return errors.New("STRIPE_WEBHOOK_SECRET is required when Stripe billing is enabled")
		}
		if !validProductionAppBaseURL(c.Billing.AppBaseURL) {
			return errors.New("APP_BASE_URL must be set to the production URL when Stripe billing is enabled")
		}
	}
	return nil
}

func (c PasswordResetConfig) ResendConfigured() bool {
	return c.ResendAPIKey != "" && c.ResendFrom != ""
}

func (c BillingConfig) StripeConfigured() bool {
	return c.StripeBillingEnabled &&
		c.StripeSecretKey != "" &&
		c.StripeMonthlyPrice != "" &&
		c.StripeMonthlyPrice != "price_1TpAeQRiiEo9jrWNlLdI9HwB" &&
		c.StripeWebhookSecret != "" &&
		c.AppBaseURL != "" &&
		!strings.HasPrefix(c.AppBaseURL, "http://localhost")
}

func valueOrDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func intOrDefault(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func emailListOrDefault(value string, fallback []string) []string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parts := strings.Split(value, ",")
	emails := make([]string, 0, len(parts))
	for _, part := range parts {
		email := strings.ToLower(strings.TrimSpace(part))
		if email != "" {
			emails = append(emails, email)
		}
	}
	if len(emails) == 0 {
		return fallback
	}
	return emails
}

func boolFromEnv(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func validProductionAppBaseURL(value string) bool {
	return value != "" && !strings.HasPrefix(value, "http://localhost")
}
