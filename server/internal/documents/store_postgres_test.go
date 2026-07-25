package documents

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

// newPostgresStore boots a real database so the share-password SQL is exercised
// rather than mocked. Skips when no test database is configured.
func newPostgresStore(t *testing.T) (*Store, string) {
	t.Helper()
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	var ownerID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'x')
		RETURNING id::text
	`, "share-password-"+time.Now().Format("20060102150405.000000000")+"@example.test").Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID)
		_, _ = db.Exec(context.Background(), `DELETE FROM document_unlock_rate_limits`)
	})
	return NewStore(db), ownerID
}

func TestSharePasswordLifecycleWithPostgres(t *testing.T) {
	store, ownerID := newPostgresStore(t)
	ctx := context.Background()

	doc, err := store.Create(ctx, ownerID, "# Numbers\n\nSecret.", NoSavedDocumentLimit)
	if err != nil {
		t.Fatal(err)
	}
	if doc.PasswordProtected {
		t.Fatal("a new document is password protected")
	}

	// A password on an unshared document is meaningless and must be refused.
	if _, err := store.SetSharePassword(ctx, ownerID, doc.ID, "hash"); !errors.Is(err, ErrNotShared) {
		t.Fatalf("SetSharePassword on unshared doc = %v, want %v", err, ErrNotShared)
	}

	if _, err := store.Share(ctx, ownerID, doc.ID); err != nil {
		t.Fatal(err)
	}
	protected, err := store.SetSharePassword(ctx, ownerID, doc.ID, "hashed-value")
	if err != nil {
		t.Fatal(err)
	}
	if !protected.PasswordProtected || protected.SharePasswordHash != "hashed-value" {
		t.Fatalf("document not protected: %+v", protected)
	}

	public, err := store.GetPublic(ctx, doc.PublicID)
	if err != nil {
		t.Fatal(err)
	}
	if public.SharePasswordHash != "hashed-value" {
		t.Fatal("public lookup lost the password hash")
	}

	cleared, err := store.ClearSharePassword(ctx, ownerID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.PasswordProtected || cleared.SharePasswordHash != "" {
		t.Fatalf("password not cleared: %+v", cleared)
	}
	if cleared.SharedAt == nil {
		t.Fatal("clearing the password also unshared the document")
	}
}

func TestUnshareClearsTheSharePasswordWithPostgres(t *testing.T) {
	store, ownerID := newPostgresStore(t)
	ctx := context.Background()

	doc, err := store.Create(ctx, ownerID, "# Numbers", NoSavedDocumentLimit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Share(ctx, ownerID, doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetSharePassword(ctx, ownerID, doc.ID, "hashed-value"); err != nil {
		t.Fatal(err)
	}
	if err := store.Unshare(ctx, ownerID, doc.ID); err != nil {
		t.Fatal(err)
	}

	reshared, err := store.Share(ctx, ownerID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reshared.PasswordProtected {
		t.Fatal("re-sharing inherited a stale password")
	}
}

func TestSharePasswordIsScopedToTheOwnerWithPostgres(t *testing.T) {
	store, ownerID := newPostgresStore(t)
	_, otherOwnerID := newPostgresStore(t)
	ctx := context.Background()

	doc, err := store.Create(ctx, ownerID, "# Numbers", NoSavedDocumentLimit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Share(ctx, ownerID, doc.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := store.SetSharePassword(ctx, otherOwnerID, doc.ID, "hashed-value"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SetSharePassword by another owner = %v, want %v", err, ErrNotFound)
	}
	if _, err := store.ClearSharePassword(ctx, otherOwnerID, doc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ClearSharePassword by another owner = %v, want %v", err, ErrNotFound)
	}
}

func TestUnlockRateLimitWithPostgres(t *testing.T) {
	store, _ := newPostgresStore(t)
	ctx := context.Background()
	now := time.Now()
	ipHash := hashKey("203.0.113.7")
	documentHash := hashKey("doc-under-attack")

	for attempt := 1; attempt <= unlockLimit; attempt++ {
		if _, err := store.ConsumeUnlockAttempt(ctx, ipHash, documentHash, now, unlockWindow, unlockLimit); err != nil {
			t.Fatalf("attempt %d = %v, want nil", attempt, err)
		}
	}

	retryAfter, err := store.ConsumeUnlockAttempt(ctx, ipHash, documentHash, now, unlockWindow, unlockLimit)
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("attempt %d = %v, want %v", unlockLimit+1, err, ErrRateLimited)
	}
	if retryAfter <= 0 {
		t.Fatalf("retryAfter = %v, want a positive delay", retryAfter)
	}

	// A correct password clears this document's counter for the client, so an
	// honest visitor who mistyped is not stuck.
	if err := store.ResetUnlockAttempts(ctx, documentHash); err != nil {
		t.Fatal(err)
	}
	// The cross-document IP counter must survive: knowing one password must not
	// buy a fresh budget for scanning other documents.
	var ipAttempts int
	if err := store.db.QueryRow(ctx, `
		SELECT attempts FROM document_unlock_rate_limits
		WHERE dimension = 'ip' AND key_hash = $1
	`, ipHash).Scan(&ipAttempts); err != nil {
		t.Fatalf("ip counter was deleted by a successful unlock: %v", err)
	}
	if ipAttempts < unlockLimit {
		t.Fatalf("ip attempts = %d, want the counter preserved", ipAttempts)
	}

	// The window rolls over rather than locking the document out forever.
	for attempt := 1; attempt <= unlockLimit+1; attempt++ {
		_, _ = store.ConsumeUnlockAttempt(ctx, ipHash, documentHash, now, unlockWindow, unlockLimit)
	}
	if _, err := store.ConsumeUnlockAttempt(ctx, ipHash, documentHash, now.Add(unlockWindow+time.Second), unlockWindow, unlockLimit); err != nil {
		t.Fatalf("after window rollover = %v, want nil", err)
	}
}
