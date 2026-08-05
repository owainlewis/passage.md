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
	policyAcceptedAt := time.Date(2026, time.July, 27, 11, 0, 0, 0, time.UTC)
	var userID string
	err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, policy_version, policy_accepted_at)
		VALUES ($1, 'test-hash', '2026-07-27', $2)
		RETURNING id::text
	`, email, policyAcceptedAt).Scan(&userID)
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
		{`INSERT INTO templates (owner_user_id, title, description, body) VALUES ($1, 'YouTube script', 'Plan a concise product video.', '# Video title')`, []any{userID}},
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
	for _, name := range []string{"account.json", "documents.json", "templates.json", "api-tokens.json"} {
		if _, ok := files[name]; !ok {
			t.Fatalf("missing %s", name)
		}
	}
	var exported accountExport
	if err := json.Unmarshal(files["account.json"], &exported); err != nil {
		t.Fatal(err)
	}
	if exported.Account.PolicyVersion == nil || *exported.Account.PolicyVersion != "2026-07-27" ||
		exported.Account.PolicyAcceptedAt == nil || !exported.Account.PolicyAcceptedAt.Equal(policyAcceptedAt) {
		t.Fatalf("exported policy acceptance = %#v/%#v", exported.Account.PolicyVersion, exported.Account.PolicyAcceptedAt)
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
	var templateManifest []Template
	if err := json.Unmarshal(files["templates.json"], &templateManifest); err != nil {
		t.Fatal(err)
	}
	if len(templateManifest) != 1 || templateManifest[0].Title != "YouTube script" || templateManifest[0].Description != "Plan a concise product video." {
		t.Fatalf("templates = %#v, want YouTube script", templateManifest)
	}
	if body, ok := files[templateManifest[0].Path]; !ok || string(body) != "# Video title" {
		t.Fatalf("missing Markdown body for template %s", templateManifest[0].ID)
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
		"templates":        `SELECT count(*) FROM templates WHERE owner_user_id = $1`,
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
	if err := Delete(ctx, db, email, DeleteOptions{}); !errors.Is(err, ErrStripeNeutralizerRequired) {
		t.Fatalf("delete terminal subscription without Stripe neutralizer error = %v", err)
	}
	customerID := fmt.Sprintf("cus_%d", stamp)
	stripe := &fakeStripeNeutralizer{}
	if err := Delete(ctx, db, email, DeleteOptions{Stripe: stripe}); err != nil {
		t.Fatal(err)
	}
	if len(stripe.customerIDs) != 1 || stripe.customerIDs[0] != customerID {
		t.Fatalf("neutralized customers = %v, want [%s]", stripe.customerIDs, customerID)
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
	customerID := fmt.Sprintf("cus_checkout_%d", stamp)
	_, err = db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id)
		VALUES ($1, $2)
	`, userID, customerID)
	if err != nil {
		t.Fatal(err)
	}

	if err := Delete(ctx, db, email, DeleteOptions{}); !errors.Is(err, ErrActiveSubscription) {
		t.Fatalf("delete unverified Stripe customer error = %v", err)
	}
	if err := Delete(ctx, db, email, DeleteOptions{StripeVerifiedNoActiveSubscription: true}); !errors.Is(err, ErrStripeNeutralizerRequired) {
		t.Fatalf("delete without Stripe neutralizer error = %v", err)
	}
	stripeFailure := errors.New("Stripe unavailable")
	failingStripe := &fakeStripeNeutralizer{err: stripeFailure}
	if err := Delete(ctx, db, email, DeleteOptions{
		StripeVerifiedNoActiveSubscription: true,
		Stripe:                             failingStripe,
	}); !errors.Is(err, stripeFailure) {
		t.Fatalf("delete after Stripe failure error = %v", err)
	}
	var remaining int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, userID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("users after committed deletion = %d, want 0", remaining)
	}
	var pending int
	if err := db.QueryRow(ctx, `
		SELECT count(*) FROM stripe_customer_cleanup_jobs
		WHERE account_email = $1 AND stripe_customer_id = $2
	`, email, customerID).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatalf("pending Stripe cleanup jobs = %d, want 1", pending)
	}

	var recreatedUserID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'new-account-hash')
		RETURNING id::text
	`, email).Scan(&recreatedUserID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, recreatedUserID)
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body)
		VALUES ($1, $2, 'Recreated account document', '# Keep this document')
	`, recreatedUserID, fmt.Sprintf("recreated-%d", stamp)); err != nil {
		t.Fatal(err)
	}

	stripe := &fakeStripeNeutralizer{}
	if err := Delete(ctx, db, email, DeleteOptions{
		StripeVerifiedNoActiveSubscription: true,
		Stripe:                             stripe,
	}); !errors.Is(err, ErrPriorAccountStripeCleanupPending) {
		t.Fatalf("delete with prior cleanup error = %v, want ErrPriorAccountStripeCleanupPending", err)
	}
	if len(stripe.customerIDs) != 0 {
		t.Fatalf("Stripe calls from recreated-account deletion = %v, want none", stripe.customerIDs)
	}
	if err := CleanupStripeCustomer(ctx, db, customerID, stripe); err != nil {
		t.Fatal(err)
	}
	if len(stripe.customerIDs) != 1 || stripe.customerIDs[0] != customerID {
		t.Fatalf("neutralized customers from dedicated cleanup = %v, want [%s]", stripe.customerIDs, customerID)
	}
	if err := db.QueryRow(ctx, `
		SELECT count(*) FROM stripe_customer_cleanup_jobs
		WHERE account_email = $1
	`, email).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("pending Stripe cleanup jobs after retry = %d, want 0", pending)
	}
	var recreatedRows int
	if err := db.QueryRow(ctx, `
		SELECT count(*)
		FROM users
		JOIN documents ON documents.owner_user_id = users.id
		WHERE users.id = $1
	`, recreatedUserID).Scan(&recreatedRows); err != nil {
		t.Fatal(err)
	}
	if recreatedRows != 1 {
		t.Fatalf("recreated account and document rows after cleanup retry = %d, want 1", recreatedRows)
	}

	if err := Delete(ctx, db, email, DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, recreatedUserID).Scan(&recreatedRows); err != nil {
		t.Fatal(err)
	}
	if recreatedRows != 0 {
		t.Fatalf("recreated account rows after separately confirmed deletion = %d, want 0", recreatedRows)
	}
}

func TestExportTransactionKeepsConsistentSnapshotDuringDeletion(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-export-snapshot-%d@example.com", stamp)
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body)
		VALUES ($1, $2, 'Snapshot document', '# Snapshot')
	`, userID, fmt.Sprintf("snapshot%d", stamp)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO api_tokens (user_id, name, token_hash)
		VALUES ($1, 'Snapshot token', $2)
	`, userID, fmt.Sprintf("snapshot-token-%d", stamp)); err != nil {
		t.Fatal(err)
	}

	tx, err := beginExportTransaction(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	account, err := loadAccount(ctx, tx, email, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(io.Discard)
	documents, err := writeDocuments(ctx, tx, writer, account.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	tokens, err := loadTokens(ctx, tx, account.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 1 || len(tokens) != 1 {
		t.Fatalf("snapshot has %d documents and %d tokens, want 1 and 1", len(documents), len(tokens))
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteDoesNotTouchStripeWhenDatabaseDeletionFails(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-data-db-failure-%d@example.com", stamp)
	customerID := fmt.Sprintf("cus_db_failure_%d", stamp)
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if _, err := db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id, stripe_subscription_status)
		VALUES ($1, $2, 'canceled')
	`, userID, customerID); err != nil {
		t.Fatal(err)
	}

	functionName := fmt.Sprintf("fail_account_delete_%d", stamp)
	triggerName := fmt.Sprintf("fail_account_delete_trigger_%d", stamp)
	if _, err := db.Exec(ctx, fmt.Sprintf(`
		CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
		  IF OLD.email = %s THEN
		    RAISE EXCEPTION 'forced account deletion failure';
		  END IF;
		  RETURN OLD;
		END
		$$;
		CREATE TRIGGER %s BEFORE DELETE ON users
		FOR EACH ROW EXECUTE FUNCTION %s()
	`, functionName, quoteSQLLiteral(email), triggerName, functionName)); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON users; DROP FUNCTION IF EXISTS %s()`, triggerName, functionName))

	stripe := &fakeStripeNeutralizer{}
	if err := Delete(ctx, db, email, DeleteOptions{Stripe: stripe}); err == nil {
		t.Fatal("delete error = nil, want forced database failure")
	}
	if len(stripe.customerIDs) != 0 {
		t.Fatalf("Stripe calls before local commit = %v, want none", stripe.customerIDs)
	}
	var users int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, userID).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("users after database failure = %d, want 1", users)
	}
	var jobs int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM stripe_customer_cleanup_jobs WHERE account_email = $1`, email).Scan(&jobs); err != nil {
		t.Fatal(err)
	}
	if jobs != 0 {
		t.Fatalf("cleanup jobs after rolled-back deletion = %d, want 0", jobs)
	}
}

func TestExportStreamsLargeArchivedAccount(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	email := fmt.Sprintf("account-export-large-%d@example.com", stamp)
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	const documentCount = 48
	const documentSize = 512 * 1024
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body, archived_at)
		SELECT $1,
		       $2 || '-' || series::text,
		       'Large archived document ' || series::text,
		       repeat('x', $3),
		       now()
		FROM generate_series(1, $4) AS series
	`, userID, fmt.Sprintf("large-%d", stamp), documentSize, documentCount); err != nil {
		t.Fatal(err)
	}

	outputPath := filepath.Join(t.TempDir(), "large-account-export.zip")
	if err := Export(ctx, db, email, outputPath, time.Now()); err != nil {
		t.Fatal(err)
	}
	files := readExport(t, outputPath)
	var manifest []Document
	if err := json.Unmarshal(files["documents.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest) != documentCount {
		t.Fatalf("document manifest count = %d, want %d", len(manifest), documentCount)
	}
	for _, document := range manifest {
		if got := len(files[document.Path]); got != documentSize {
			t.Fatalf("%s size = %d, want %d", document.Path, got, documentSize)
		}
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

type fakeStripeNeutralizer struct {
	customerIDs []string
	err         error
}

func (f *fakeStripeNeutralizer) NeutralizeUnsubscribedCustomer(_ context.Context, customerID string) error {
	f.customerIDs = append(f.customerIDs, customerID)
	return f.err
}

func quoteSQLLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
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
