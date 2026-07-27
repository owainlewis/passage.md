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

	"github.com/owainlewis/passage.md/server/internal/accountdata"
	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
	passagehttp "github.com/owainlewis/passage.md/server/internal/server"
	"github.com/owainlewis/passage.md/server/internal/web"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
			if attr.Key == slog.LevelKey {
				attr.Key = "severity"
			}
			if attr.Key == slog.TimeKey {
				attr.Key = "timestamp"
			}
			return attr
		},
	})))
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
	case "account":
		return account(cfg, args[2:])
	default:
		return usage()
	}
}

func usage() error {
	return errors.New("usage: passage serve|migrate|user <email>|account export <email> <output.zip>|account delete <email> --confirm <email> [--stripe-verified-no-active-subscription]")
}

func serve(cfg config.Config) error {
	if err := cfg.ValidateServe(); err != nil {
		return err
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

	var passwordResetSender auth.PasswordResetSender
	if cfg.PasswordReset.ResendConfigured() {
		passwordResetSender = auth.NewResendSender(cfg.PasswordReset.ResendAPIKey, cfg.PasswordReset.ResendFrom, nil)
	} else if cfg.AppEnv != "production" {
		passwordResetSender = auth.LoggingPasswordResetSender{}
	}
	app := passagehttp.NewApp(staticFS, db, passagehttp.Options{
		SessionSecret:       cfg.SessionSecret,
		CookieSecure:        cfg.CookieSecure,
		AppBaseURL:          cfg.PasswordReset.AppBaseURL,
		PasswordResetSender: passwordResetSender,
		Billing:             cfg.Billing,
		RateLimits:          cfg.RateLimits,
		Proxy:               cfg.Proxy,
		GCPProjectID:        os.Getenv("GCP_PROJECT_ID"),
	})
	go app.RunPasswordResetWorker(ctx)
	server := newHTTPServer(cfg.Port, app.Routes())

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

func newHTTPServer(port string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
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

func account(cfg config.Config, args []string) error {
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if len(args) < 1 {
		return usage()
	}
	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()

	switch args[0] {
	case "export":
		if len(args) != 3 {
			return errors.New("usage: passage account export <email> <output.zip>")
		}
		if err := accountdata.Export(ctx, db, args[1], args[2], time.Now()); err != nil {
			return fmt.Errorf("export account: %w", err)
		}
		fmt.Printf("account export written to %s\n", args[2])
		return nil
	case "delete":
		validLength := len(args) == 4 || len(args) == 5
		if !validLength ||
			args[2] != "--confirm" ||
			!strings.EqualFold(strings.TrimSpace(args[1]), strings.TrimSpace(args[3])) ||
			(len(args) == 5 && args[4] != "--stripe-verified-no-active-subscription") {
			return errors.New("usage: passage account delete <email> --confirm <same-email> [--stripe-verified-no-active-subscription]")
		}
		options := accountdata.DeleteOptions{StripeVerifiedNoActiveSubscription: len(args) == 5}
		if err := accountdata.Delete(ctx, db, args[1], options); err != nil {
			return fmt.Errorf("delete account: %w", err)
		}
		fmt.Printf("account permanently deleted: %s\n", strings.ToLower(strings.TrimSpace(args[1])))
		return nil
	default:
		return usage()
	}
}

func generatedPassword() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
