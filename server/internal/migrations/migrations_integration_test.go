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

func TestRemoveCollectionsMigrationKeepsEveryDocument(t *testing.T) {
	db := isolatedMigrationDatabase(t)
	ctx := context.Background()
	applyBeforeMigration(t, db, "028_remove_collections.sql")

	var ownerID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ('remove-collections@example.com', 'hash')
		RETURNING id::text
	`).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	var collectionID string
	if err := db.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title)
		VALUES ($1, 'research', 'Research')
		RETURNING id::text
	`, ownerID).Scan(&collectionID); err != nil {
		t.Fatal(err)
	}
	for index, document := range []struct {
		collectionID *string
		starred      bool
		shared       bool
		archived     bool
	}{
		{collectionID: &collectionID, starred: true, shared: true},
		{collectionID: &collectionID, archived: true},
		{},
	} {
		sharedAt, shareToken, archivedAt := "NULL", "NULL", "NULL"
		if document.shared {
			sharedAt, shareToken = "'2026-08-14T08:30:00Z'::timestamptz", fmt.Sprintf("'remove-collections-share-%02d'", index)
		}
		if document.archived {
			archivedAt = "'2026-08-14T09:00:00Z'::timestamptz"
		}
		if _, err := db.Exec(ctx, fmt.Sprintf(`
			INSERT INTO documents (
				owner_user_id, public_id, title, body, collection_id, starred,
				share_token, shared_at, archived_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, %s, %s, %s,
				'2026-08-13T08:00:00Z', '2026-08-14T08:00:00Z'
			)
		`, shareToken, sharedAt, archivedAt),
			ownerID,
			fmt.Sprintf("removecollections%05d", index),
			fmt.Sprintf("Document %d", index),
			fmt.Sprintf("---\nkeep: %d\n---\n\n# Document %d\n\nEvery byte stays.\n", index, index),
			document.collectionID,
			document.starred,
		); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := func() string {
		t.Helper()
		var value string
		if err := db.QueryRow(ctx, `
			SELECT string_agg(concat_ws('|', id, public_id, title, md5(body), starred,
			                            share_token, shared_at, archived_at,
			                            created_at, updated_at, content_version), E'\n' ORDER BY public_id)
			FROM documents
			WHERE owner_user_id = $1
		`, ownerID).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := snapshot()

	applied, err := Apply(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(applied, ",") != "028_remove_collections" {
		t.Fatalf("applied migrations = %q", applied)
	}
	if after := snapshot(); after != before {
		t.Fatalf("documents changed:\nbefore %s\nafter  %s", before, after)
	}
	var table, column, function bool
	if err := db.QueryRow(ctx, `
		SELECT to_regclass('collections') IS NOT NULL,
		       EXISTS (
		         SELECT 1 FROM information_schema.columns
		         WHERE table_schema = current_schema() AND table_name = 'documents' AND column_name = 'collection_id'
		       ),
		       to_regprocedure('keep_collection_slug_immutable()') IS NOT NULL
	`).Scan(&table, &column, &function); err != nil {
		t.Fatal(err)
	}
	if table || column || function {
		t.Fatalf("collection schema left behind: table %v, column %v, function %v", table, column, function)
	}
	if applied, err = Apply(ctx, db); err != nil || len(applied) != 0 {
		t.Fatalf("repeated migration applied %q: %v", applied, err)
	}
}

func TestDocumentSearchMigrationAppliesToFreshAndPopulatedDatabases(t *testing.T) {
	t.Run("fresh", func(t *testing.T) {
		db := isolatedMigrationDatabase(t)
		if _, err := Apply(context.Background(), db); err != nil {
			t.Fatal(err)
		}
		assertDocumentSearchSchema(t, db)
	})

	t.Run("populated", func(t *testing.T) {
		db := isolatedMigrationDatabase(t)
		ctx := context.Background()
		applyBeforeMigration(t, db, "024_document_full_text_search.sql")
		var ownerID string
		if err := db.QueryRow(ctx, `
			INSERT INTO users (email, password_hash)
			VALUES ('before-search@example.com', 'hash')
			RETURNING id::text
		`).Scan(&ownerID); err != nil {
			t.Fatal(err)
		}
		const body = "# Existing document\n\nA searchable migration marker."
		var documentID string
		if err := db.QueryRow(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body)
			VALUES ($1, 'migrationsearchfixture', 'Existing document', $2)
			RETURNING id::text
		`, ownerID, body).Scan(&documentID); err != nil {
			t.Fatal(err)
		}

		applied, err := Apply(ctx, db)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(applied, ",") != "024_document_full_text_search,025_remove_seeded_collections,026_document_content_version,027_document_contributors,028_remove_collections" {
			t.Fatalf("applied migrations = %q", applied)
		}
		assertDocumentSearchSchema(t, db)
		var gotBody string
		var matches bool
		if err := db.QueryRow(ctx, `
			SELECT body, search_vector @@ websearch_to_tsquery('simple'::regconfig, 'migration marker')
			FROM documents WHERE id = $1
		`, documentID).Scan(&gotBody, &matches); err != nil {
			t.Fatal(err)
		}
		if gotBody != body || !matches {
			t.Fatalf("populated document body/match = %q/%v", gotBody, matches)
		}
		if applied, err = Apply(ctx, db); err != nil || len(applied) != 0 {
			t.Fatalf("repeated migration applied %q: %v", applied, err)
		}
	})
}

func assertDocumentSearchSchema(t *testing.T, db *database.Pool) {
	t.Helper()
	ctx := context.Background()
	var generated string
	if err := db.QueryRow(ctx, `
		SELECT attgenerated
		FROM pg_attribute
		WHERE attrelid = 'documents'::regclass AND attname = 'search_vector'
	`).Scan(&generated); err != nil {
		t.Fatal(err)
	}
	if generated != "s" {
		t.Fatalf("search_vector generated kind = %q", generated)
	}
	var definition string
	if err := db.QueryRow(ctx, `
		SELECT indexdef FROM pg_indexes
		WHERE schemaname = current_schema() AND indexname = 'documents_active_search_idx'
	`).Scan(&definition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(definition, "USING gin (search_vector)") || !strings.Contains(definition, "archived_at IS NULL") {
		t.Fatalf("search index definition = %q", definition)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO abuse_rate_limits (
			scope, key_hash, window_started_at, expires_at, requests
		) VALUES (
			'document_search', repeat('a', 64), now(), now() + interval '1 minute', 1
		)
	`); err != nil {
		t.Fatalf("document_search rate limit scope is not allowed: %v", err)
	}
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

func applyBeforeMigration(t *testing.T, db *database.Pool, stopBefore string) {
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
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" || entry.Name() >= stopBefore {
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
