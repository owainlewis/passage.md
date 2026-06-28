package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
	passagehttp "github.com/owainlewis/passage.md/server/internal/server"
	"github.com/owainlewis/passage.md/server/internal/web"
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
	default:
		return usage()
	}
}

func usage() error {
	return errors.New("usage: passage serve|migrate")
}

func serve(cfg config.Config) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var db *database.Pool
	if cfg.DatabaseURL != "" {
		opened, err := database.Open(ctx, cfg.DatabaseURL)
		if err != nil {
			return fmt.Errorf("connect database: %w", err)
		}
		defer opened.Close()
		db = opened
	}

	staticFS, err := web.FileSystem(cfg.StaticDir)
	if err != nil {
		return err
	}

	app := passagehttp.NewApp(staticFS, db)
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
