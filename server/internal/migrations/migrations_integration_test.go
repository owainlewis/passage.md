package migrations

import (
	"context"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
)

func TestCollectionsMigrationPreservesPopulatedDataAndIsIdempotent(t *testing.T) {
	db := isolatedMigrationDatabase(t)
	ctx := context.Background()
	applyBeforeCollections(t, db)

	var ownerID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ('before-collections@example.com', 'hash')
		RETURNING id::text
	`).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	const documentID = "11111111-1111-1111-1111-111111111111"
	const publicID = "abcdefghijklmnopqrstuv"
	const shareToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const body = "---\ntags: [research]\n---\n\n# Unchanged Markdown"
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (
			id, owner_user_id, public_id, title, body, share_token, shared_at
		) VALUES ($1, $2, $3, 'Unchanged Markdown', $4, $5, now())
	`, documentID, ownerID, publicID, body, shareToken); err != nil {
		t.Fatal(err)
	}

	applied, err := Apply(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(applied, ",") != "023_collections" {
		t.Fatalf("applied migrations = %q", applied)
	}
	assertFourDefaultCollections(t, db, ownerID)

	var gotOwnerID, gotPublicID, gotBody string
	var gotShareToken *string
	var collectionID *string
	var starred bool
	if err := db.QueryRow(ctx, `
		SELECT owner_user_id::text, public_id, body, share_token, collection_id::text, starred
		FROM documents
		WHERE id = $1
	`, documentID).Scan(&gotOwnerID, &gotPublicID, &gotBody, &gotShareToken, &collectionID, &starred); err != nil {
		t.Fatal(err)
	}
	if gotOwnerID != ownerID || gotPublicID != publicID || gotBody != body || gotShareToken == nil || *gotShareToken != shareToken {
		t.Fatalf("migrated document changed: owner=%q public=%q body=%q share=%v", gotOwnerID, gotPublicID, gotBody, gotShareToken)
	}
	if collectionID != nil || starred {
		t.Fatalf("pre-migration metadata = collection %v, starred %v", collectionID, starred)
	}

	applied, err = Apply(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 0 {
		t.Fatalf("repeated migration applied %q", applied)
	}
	assertFourDefaultCollections(t, db, ownerID)

	var newOwnerID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ('after-collections@example.com', 'hash')
		RETURNING id::text
	`).Scan(&newOwnerID); err != nil {
		t.Fatal(err)
	}
	assertFourDefaultCollections(t, db, newOwnerID)
}

func isolatedMigrationDatabase(t *testing.T) *database.Pool {
	t.Helper()
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("migration_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		admin.Close()
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := database.Open(ctx, parsed.String())
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return db
}

func applyBeforeCollections(t *testing.T, db *database.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec(ctx, `
		CREATE TABLE schema_migrations (
			version text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`); err != nil {
		t.Fatal(err)
	}
	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" || entry.Name() >= "023_collections.sql" {
			continue
		}
		body, err := files.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("apply %s: %v", entry.Name(), err)
		}
		version := strings.TrimSuffix(entry.Name(), ".sql")
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

func assertFourDefaultCollections(t *testing.T, db *database.Pool, ownerID string) {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT slug FROM collections WHERE owner_user_id = $1 ORDER BY slug
	`, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var slugs []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			t.Fatal(err)
		}
		slugs = append(slugs, slug)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(slugs, ","); got != "content-studio,operating-context,passage,research" {
		t.Fatalf("default collection slugs = %q", got)
	}
}
