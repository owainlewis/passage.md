package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
	passagehttp "github.com/owainlewis/passage.md/server/internal/server"
	"github.com/owainlewis/passage.md/server/internal/web"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	if err := run(os.Args); err != nil {
		slog.Error("command failed", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) < 2 {
		return usage()
	}

	cfg := config.FromEnv()
	switch args[1] {
	case "serve":
		return serve(cfg)
	case "migrate":
		return migrate(cfg)
	case "user":
		return user(cfg, args[2:])
	default:
		return usage()
	}
}

func usage() error {
	return errors.New("usage: passage serve|migrate|user <email>")
}

func serve(cfg config.Config) error {
	if cfg.SessionSecret == "" {
		return errors.New("SESSION_SECRET is required")
	}
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()
	if _, err := migrations.Apply(ctx, db); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	staticFS, err := web.FileSystem(cfg.StaticDir)
	if err != nil {
		return err
	}

	app := passagehttp.NewApp(staticFS, db, passagehttp.Options{
		SessionSecret: cfg.SessionSecret,
		CookieSecure:  cfg.CookieSecure,
	})
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           app.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		slog.Info("serving passage.md", "addr", server.Addr)
		errs <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return nil
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func migrate(cfg config.Config) error {
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()

	applied, err := migrations.Apply(ctx, db)
	if err != nil {
		return err
	}
	for _, version := range applied {
		fmt.Println(version)
	}
	if len(applied) == 0 {
		fmt.Println("migrations already up to date")
	}
	return nil
}

func user(cfg config.Config, args []string) error {
	if len(args) != 1 || strings.TrimSpace(args[0]) == "" {
		return errors.New("usage: passage user <email>")
	}
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	password, err := generatedPassword()
	if err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()

	emailInput := strings.ToLower(strings.TrimSpace(args[0]))
	var email string
	err = db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		ON CONFLICT (email) DO UPDATE
		SET password_hash = EXCLUDED.password_hash,
		    updated_at = now()
		RETURNING email
	`, emailInput, string(hash)).Scan(&email)
	if err != nil {
		return fmt.Errorf("save user: %w", err)
	}

	fmt.Printf("email: %s\n", email)
	fmt.Printf("password: %s\n", password)
	fmt.Println("Store this password now. It will not be shown again.")
	return nil
}

func generatedPassword() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
