package config

import "os"

type Config struct {
	Port          string
	DatabaseURL   string
	StaticDir     string
	SessionSecret string
	CookieSecure  bool
}

func FromEnv() Config {
	appEnv := os.Getenv("APP_ENV")
	sessionSecret := os.Getenv("SESSION_SECRET")
	if sessionSecret == "" && appEnv != "production" {
		sessionSecret = "dev-session-secret-change-me"
	}
	return Config{
		Port:          valueOrDefault(os.Getenv("PORT"), "8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		StaticDir:     os.Getenv("STATIC_DIR"),
		SessionSecret: sessionSecret,
		CookieSecure:  appEnv == "production",
	}
}

func valueOrDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
