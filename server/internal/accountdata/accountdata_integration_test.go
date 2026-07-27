package accountdata

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestExportAndDeleteAccount(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-data-%d@example.com", stamp)
	var userID string
	err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)

	fixtures := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, []any{userID, fmt.Sprintf("session-%d", stamp)}},
		{`INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, 'Support test', $2)`, []any{userID, fmt.Sprintf("token-%d", stamp)}},
		{`INSERT INTO billing_accounts (user_id, manual_plan, max_saved_docs) VALUES ($1, 'pro', 1000)`, []any{userID}},
		{`INSERT INTO documents (owner_user_id, public_id, title, body) VALUES ($1, $2, 'Active document', '# Active document')`, []any{userID, fmt.Sprintf("public%dA", stamp)}},
		{`INSERT INTO documents (owner_user_id, public_id, title, body, archived_at) VALUES ($1, $2, 'Archived document', '# Archived document', now())`, []any{userID, fmt.Sprintf("public%dB", stamp)}},
		{`INSERT INTO password_reset_requests (email, processed_at) VALUES ($1, now())`, []any{email}},
		{`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, []any{userID, fmt.Sprintf("reset-token-%d", stamp)}},
		{`INSERT INTO password_reset_confirmation_rate_limits (dimension, key_hash, window_started_at, attempts) VALUES ('token', $1, now(), 1)`, []any{fmt.Sprintf("reset-token-%d", stamp)}},
	}
	for _, fixture := range fixtures {
		if _, err := db.Exec(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatal(err)
		}
	}
	emailHash := sha256.Sum256([]byte(email))
	if _, err := db.Exec(ctx, `
		INSERT INTO password_reset_rate_limits (dimension, key_hash, window_started_at, attempts)
		VALUES ('email', $1, now(), 1)
	`, hex.EncodeToString(emailHash[:])); err != nil {
		t.Fatal(err)
	}

	outputPath := filepath.Join(t.TempDir(), "account-export.zip")
	exportedAt := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	if err := Export(ctx, db, strings.ToUpper(email), outputPath, exportedAt); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("export permissions = %o, want 600", info.Mode().Perm())
	}
	files := readExport(t, outputPath)
	for _, name := range []string{"account.json", "documents.json", "api-tokens.json"} {
		if _, ok := files[name]; !ok {
			t.Fatalf("missing %s", name)
		}
	}
	var manifest []Document
	if err := json.Unmarshal(files["documents.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest) != 2 {
		t.Fatalf("documents = %d, want 2", len(manifest))
	}
	for _, document := range manifest {
		body, ok := files[document.Path]
		if !ok || !strings.HasPrefix(string(body), "# ") {
			t.Fatalf("missing Markdown body for %s", document.ID)
		}
	}
	if err := Export(ctx, db, email, outputPath, exportedAt); !errors.Is(err, os.ErrExist) {
		t.Fatalf("second export error = %v, want file exists", err)
	}

	if err := Delete(ctx, db, "  "+strings.ToUpper(email)+"  ", DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	for table, query := range map[string]string{
		"users":            `SELECT count(*) FROM users WHERE id = $1`,
		"sessions":         `SELECT count(*) FROM sessions WHERE user_id = $1`,
		"api_tokens":       `SELECT count(*) FROM api_tokens WHERE user_id = $1`,
		"documents":        `SELECT count(*) FROM documents WHERE owner_user_id = $1`,
		"billing_accounts": `SELECT count(*) FROM billing_accounts WHERE user_id = $1`,
	} {
		var count int
		if err := db.QueryRow(ctx, query, userID).Scan(&count); err != nil {
			t.Fatalf("%s count: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s rows = %d, want 0", table, count)
		}
	}
	var resetRequests int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM password_reset_requests WHERE email = $1`, email).Scan(&resetRequests); err != nil {
		t.Fatal(err)
	}
	if resetRequests != 0 {
		t.Fatalf("password_reset_requests rows = %d, want 0", resetRequests)
	}
	var resetRateLimits int
	if err := db.QueryRow(ctx, `
		SELECT count(*) FROM password_reset_rate_limits
		WHERE dimension = 'email' AND key_hash = $1
	`, hex.EncodeToString(emailHash[:])).Scan(&resetRateLimits); err != nil {
		t.Fatal(err)
	}
	if resetRateLimits != 0 {
		t.Fatalf("password_reset_rate_limits rows = %d, want 0", resetRateLimits)
	}
	var confirmationRateLimits int
	if err := db.QueryRow(ctx, `
		SELECT count(*) FROM password_reset_confirmation_rate_limits
		WHERE dimension = 'token' AND key_hash = $1
	`, fmt.Sprintf("reset-token-%d", stamp)).Scan(&confirmationRateLimits); err != nil {
		t.Fatal(err)
	}
	if confirmationRateLimits != 0 {
		t.Fatalf("password_reset_confirmation_rate_limits rows = %d, want 0", confirmationRateLimits)
	}
}

func TestDeleteRequiresTerminalStripeSubscription(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-data-stripe-%d@example.com", stamp)
	var userID string
	err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	_, err = db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id, stripe_subscription_status)
		VALUES ($1, $2, 'active')
	`, userID, fmt.Sprintf("cus_%d", stamp))
	if err != nil {
		t.Fatal(err)
	}

	if err := Delete(ctx, db, email, DeleteOptions{}); !errors.Is(err, ErrActiveSubscription) {
		t.Fatalf("delete active subscription error = %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE billing_accounts SET stripe_subscription_status = 'canceled' WHERE user_id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, db, email, DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteRequiresExplicitVerificationForStripeCustomerWithoutSubscription(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-data-checkout-%d@example.com", stamp)
	var userID string
	err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	_, err = db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id)
		VALUES ($1, $2)
	`, userID, fmt.Sprintf("cus_checkout_%d", stamp))
	if err != nil {
		t.Fatal(err)
	}

	if err := Delete(ctx, db, email, DeleteOptions{}); !errors.Is(err, ErrActiveSubscription) {
		t.Fatalf("delete unverified Stripe customer error = %v", err)
	}
	if err := Delete(ctx, db, email, DeleteOptions{StripeVerifiedNoActiveSubscription: true}); err != nil {
		t.Fatal(err)
	}
}

func TestDeletionCheckLocksBillingState(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-data-lock-%d@example.com", stamp)
	var userID string
	err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if _, err := db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id, stripe_subscription_status)
		VALUES ($1, $2, 'canceled')
	`, userID, fmt.Sprintf("cus_lock_%d", stamp)); err != nil {
		t.Fatal(err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	account, err := loadAccount(ctx, tx, email, "FOR UPDATE OF users")
	if err != nil {
		t.Fatal(err)
	}
	if err := lockBillingState(ctx, tx, &account); err != nil {
		t.Fatal(err)
	}

	updateCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	_, err = db.Exec(updateCtx, `
		UPDATE billing_accounts
		SET stripe_subscription_status = 'active'
		WHERE user_id = $1
	`, userID)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("concurrent billing update error = %v, want context deadline exceeded", err)
	}
}

func testDatabase(t *testing.T) *database.Pool {
	t.Helper()
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}
	db, err := database.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return db
}

func readExport(t *testing.T, path string) map[string][]byte {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	files := map[string][]byte{}
	for _, file := range reader.File {
		handle, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(handle)
		if err != nil {
			_ = handle.Close()
			t.Fatal(err)
		}
		if err := handle.Close(); err != nil {
			t.Fatal(err)
		}
		files[file.Name] = body
	}
	return files
}
