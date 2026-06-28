package config

import "os"

type Config struct {
	Port        string
	DatabaseURL string
	StaticDir   string
}

func FromEnv() Config {
	return Config{
		Port:        valueOrDefault(os.Getenv("PORT"), "8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		StaticDir:   os.Getenv("STATIC_DIR"),
	}
}

func valueOrDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
