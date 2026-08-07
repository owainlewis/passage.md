package config

import (
	"errors"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv              string
	Port                string
	DatabaseURL         string
	DatabaseMaxConns    int32
	StaticDir           string
	SessionSecret       string
	CookieSecure        bool
	WritesDisabled      bool
	PublicSignupEnabled bool
	PasswordReset       PasswordResetConfig
	Billing             BillingConfig
	RateLimits          AbuseRateLimitConfig
	Proxy               ProxyConfig
}

type RateLimitConfig struct {
	Requests int
	Window   time.Duration
}

type AbuseRateLimitConfig struct {
	AuthMutation     RateLimitConfig
	DocumentMutation RateLimitConfig
	APIToken         RateLimitConfig
	SharedHTML       RateLimitConfig
	RawMarkdown      RateLimitConfig
}

type ProxyConfig struct {
	TrustedCIDRs  []string
	ForwardedHops int
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
	trustedProxyCIDRs := []string(nil)
	forwardedHops := 0
	if appEnv == "production" {
		trustedProxyCIDRs = []string{
			"10.0.0.0/8",
			"127.0.0.0/8",
			"169.254.0.0/16",
			"172.16.0.0/12",
			"192.168.0.0/16",
			"::1/128",
			"fc00::/7",
			"fe80::/10",
		}
		forwardedHops = 2
	}
	if sessionSecret == "" && appEnv != "production" {
		sessionSecret = "dev-session-secret-change-me"
	}
	return Config{
		AppEnv:              appEnv,
		Port:                valueOrDefault(os.Getenv("PORT"), "8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		DatabaseMaxConns:    positiveInt32OrDefault(os.Getenv("PASSAGE_DATABASE_MAX_CONNS"), 3),
		StaticDir:           os.Getenv("STATIC_DIR"),
		SessionSecret:       sessionSecret,
		CookieSecure:        appEnv == "production",
		WritesDisabled:      boolFromEnv(os.Getenv("PASSAGE_WRITES_DISABLED")),
		PublicSignupEnabled: boolFromEnv(os.Getenv("PASSAGE_PUBLIC_SIGNUP_ENABLED")),
		PasswordReset: PasswordResetConfig{
			AppBaseURL:   appBaseURL,
			ResendAPIKey: strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
			ResendFrom:   strings.TrimSpace(os.Getenv("RESEND_FROM")),
		},
		Billing: BillingConfig{
			StripeBillingEnabled: boolFromEnv(os.Getenv("STRIPE_BILLING_ENABLED")),
			FreeMaxSavedDocs:     intOrDefault(os.Getenv("PASSAGE_FREE_MAX_SAVED_DOCS"), 5),
			ProMaxSavedDocs:      intOrDefault(os.Getenv("PASSAGE_PRO_MAX_SAVED_DOCS"), 2000),
			OwnerEmails:          emailListOrDefault(os.Getenv("PASSAGE_OWNER_EMAILS"), []string{"owain@owainlewis.com"}),
			StripeSecretKey:      os.Getenv("STRIPE_SECRET_KEY"),
			StripeMonthlyPrice:   valueOrDefault(os.Getenv("STRIPE_MONTHLY_PRICE_ID"), "price_1TpAeQRiiEo9jrWNlLdI9HwB"),
			StripeWebhookSecret:  os.Getenv("STRIPE_WEBHOOK_SECRET"),
			AppBaseURL:           appBaseURL,
		},
		RateLimits: AbuseRateLimitConfig{
			AuthMutation:     rateLimitFromEnv("PASSAGE_RATE_LIMIT_AUTH", 20, time.Minute),
			DocumentMutation: rateLimitFromEnv("PASSAGE_RATE_LIMIT_DOCUMENT_MUTATION", 120, time.Minute),
			APIToken:         rateLimitFromEnv("PASSAGE_RATE_LIMIT_API_TOKEN", 30, time.Minute),
			SharedHTML:       rateLimitFromEnv("PASSAGE_RATE_LIMIT_SHARED_HTML", 120, time.Minute),
			RawMarkdown:      rateLimitFromEnv("PASSAGE_RATE_LIMIT_RAW_MARKDOWN", 240, time.Minute),
		},
		Proxy: ProxyConfig{
			TrustedCIDRs:  stringListOrDefault(os.Getenv("PASSAGE_TRUSTED_PROXY_CIDRS"), trustedProxyCIDRs),
			ForwardedHops: intOrDefault(os.Getenv("PASSAGE_FORWARDED_HOPS"), forwardedHops),
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
	if c.Proxy.ForwardedHops > 0 && len(c.Proxy.TrustedCIDRs) == 0 {
		return errors.New("PASSAGE_TRUSTED_PROXY_CIDRS is required when PASSAGE_FORWARDED_HOPS is greater than zero")
	}
	for _, cidr := range c.Proxy.TrustedCIDRs {
		if _, err := netip.ParsePrefix(cidr); err != nil {
			return errors.New("PASSAGE_TRUSTED_PROXY_CIDRS contains an invalid CIDR")
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

func positiveInt32OrDefault(value string, fallback int32) int32 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 32)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return int32(parsed)
}

func durationOrDefault(value string, fallback time.Duration) time.Duration {
	parsed, err := time.ParseDuration(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func rateLimitFromEnv(prefix string, defaultRequests int, defaultWindow time.Duration) RateLimitConfig {
	return RateLimitConfig{
		Requests: intOrDefault(os.Getenv(prefix+"_REQUESTS"), defaultRequests),
		Window:   durationOrDefault(os.Getenv(prefix+"_WINDOW"), defaultWindow),
	}
}

func stringListOrDefault(value string, fallback []string) []string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			values = append(values, value)
		}
	}
	return values
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
