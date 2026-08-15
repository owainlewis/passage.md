package migrations

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
)

type seedDefinition struct {
	slug        string
	title       string
	description string
}

var seededCollectionDefinitions = []seedDefinition{
	{"operating-context", "Operating Context", "Stable context, instructions, and decisions shared with agents."},
	{"content-studio", "Content Studio", "Ideas, drafts, and published work in progress."},
	{"passage", "Passage", "Product notes, plans, and working documents for Passage."},
	{"research", "Research", "Sources, findings, and notes worth returning to."},
}

type documentSnapshot struct {
	withoutCollection string
	bodyMD5           string
	collectionID      *string
}

func TestRemoveSeededCollectionsCleansExistingAccountWithoutMutatingDocuments(t *testing.T) {
	db := isolatedMigrationDatabase(t)
	ctx := context.Background()
	applyBeforeMigration(t, db, "025_remove_seeded_collections.sql")

	ownerID := insertMigrationUser(t, db, "cleanup-existing@example.com")
	collectionIDs := seededCollectionIDs(t, db, ownerID)
	if len(collectionIDs) != len(seededCollectionDefinitions) {
		t.Fatalf("seeded collections before cleanup = %d, want %d", len(collectionIDs), len(seededCollectionDefinitions))
	}

	for index, seed := range seededCollectionDefinitions {
		archivedAt := "NULL"
		if index == len(seededCollectionDefinitions)-1 {
			archivedAt = "'2026-08-14T09:00:00Z'::timestamptz"
		}
		query := fmt.Sprintf(`
			INSERT INTO documents (
				id, owner_user_id, public_id, title, body, archived_at,
				created_at, updated_at, share_token, shared_at, collection_id, starred
			) VALUES (
				$1, $2, $3, $4, $5, %s,
				'2026-08-13T08:00:00Z', '2026-08-14T08:00:00Z', $6,
				'2026-08-14T08:30:00Z', $7, $8
			)
		`, archivedAt)
		if _, err := db.Exec(ctx, query,
			fmt.Sprintf("10000000-0000-0000-0000-%012d", index+1),
			ownerID,
			fmt.Sprintf("cleanup-public-%02d", index+1),
			"Document in "+seed.title,
			"---\nseed: "+seed.slug+"\n---\n\n# Exact Markdown\n\nKeep every byte.\n",
			fmt.Sprintf("cleanup-share-token-%02d", index+1),
			collectionIDs[seed.slug],
			index%2 == 0,
		); err != nil {
			t.Fatal(err)
		}
	}

	before := migrationDocumentSnapshots(t, db, ownerID)
	applied, err := Apply(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(applied, ",") != "025_remove_seeded_collections" {
		t.Fatalf("applied migrations = %q", applied)
	}
	assertNoCollections(t, db, ownerID)
	assertSeedObjectsRemoved(t, db)

	after := migrationDocumentSnapshots(t, db, ownerID)
	if len(before) != len(after) {
		t.Fatalf("document count changed from %d to %d", len(before), len(after))
	}
	for id, beforeDocument := range before {
		afterDocument, ok := after[id]
		if !ok {
			t.Fatalf("document %s was deleted", id)
		}
		if beforeDocument.withoutCollection != afterDocument.withoutCollection {
			t.Fatalf("document %s changed outside collection_id:\nbefore: %s\nafter:  %s", id, beforeDocument.withoutCollection, afterDocument.withoutCollection)
		}
		if beforeDocument.bodyMD5 != afterDocument.bodyMD5 {
			t.Fatalf("document %s Markdown hash changed from %s to %s", id, beforeDocument.bodyMD5, afterDocument.bodyMD5)
		}
		if beforeDocument.collectionID == nil || afterDocument.collectionID != nil {
			t.Fatalf("document %s collection moved from %v to %v, want assigned to Documents", id, beforeDocument.collectionID, afterDocument.collectionID)
		}
	}

	body, err := files.ReadFile("025_remove_seeded_collections.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(body)); err != nil {
		t.Fatalf("repeat cleanup SQL: %v", err)
	}
	if repeated := migrationDocumentSnapshots(t, db, ownerID); !reflect.DeepEqual(after, repeated) {
		t.Fatalf("repeat cleanup changed documents:\nafter: %#v\nrepeat: %#v", after, repeated)
	}
}

func TestRemoveSeededCollectionsUsesNarrowOriginFingerprint(t *testing.T) {
	db := isolatedMigrationDatabase(t)
	ctx := context.Background()
	applyBeforeMigration(t, db, "025_remove_seeded_collections.sql")

	renamedOwner := insertMigrationUser(t, db, "cleanup-renamed@example.com")
	if _, err := db.Exec(ctx, `
		UPDATE collections
		SET title = 'My Operating Context', updated_at = created_at + interval '1 second'
		WHERE owner_user_id = $1 AND slug = 'operating-context'
	`, renamedOwner); err != nil {
		t.Fatal(err)
	}

	descriptionOwner := insertMigrationUser(t, db, "cleanup-description@example.com")
	if _, err := db.Exec(ctx, `
		UPDATE collections
		SET description = 'My edited description.', updated_at = created_at + interval '1 second'
		WHERE owner_user_id = $1 AND slug = 'content-studio'
	`, descriptionOwner); err != nil {
		t.Fatal(err)
	}

	recreatedOwner := insertMigrationUser(t, db, "cleanup-recreated@example.com")
	if _, err := db.Exec(ctx, `
		DELETE FROM collections
		WHERE owner_user_id = $1 AND slug = 'passage'
	`, recreatedOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO collections (owner_user_id, slug, title, description, created_at, updated_at)
		SELECT id, 'passage', 'Passage', 'Product notes, plans, and working documents for Passage.',
		       created_at + interval '1 day', created_at + interval '1 day'
		FROM users WHERE id = $1
	`, recreatedOwner); err != nil {
		t.Fatal(err)
	}

	lookalikeOwner := insertMigrationUser(t, db, "cleanup-lookalike@example.com")
	if _, err := db.Exec(ctx, `DELETE FROM collections WHERE owner_user_id = $1`, lookalikeOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO collections (owner_user_id, slug, title, description, created_at, updated_at)
		SELECT users.id, seeds.slug, seeds.title, seeds.description,
		       users.created_at + interval '1 day', users.created_at + interval '1 day'
		FROM users
		CROSS JOIN (VALUES
			('operating-context', 'Operating Context', 'Stable context, instructions, and decisions shared with agents.'),
			('content-studio', 'Content Studio', 'Ideas, drafts, and published work in progress.'),
			('passage', 'Passage', 'Product notes, plans, and working documents for Passage.'),
			('research', 'Research', 'Sources, findings, and notes worth returning to.')
		) AS seeds(slug, title, description)
		WHERE users.id = $1
	`, lookalikeOwner); err != nil {
		t.Fatal(err)
	}

	partialOwner := insertMigrationUser(t, db, "cleanup-partial@example.com")
	if _, err := db.Exec(ctx, `
		DELETE FROM collections
		WHERE owner_user_id = $1 AND slug IN ('content-studio', 'research')
	`, partialOwner); err != nil {
		t.Fatal(err)
	}

	if applied, err := Apply(ctx, db); err != nil || strings.Join(applied, ",") != "025_remove_seeded_collections" {
		t.Fatalf("apply cleanup = %q, %v", applied, err)
	}

	assertCollectionSlugs(t, db, renamedOwner, "operating-context")
	assertCollectionSlugs(t, db, descriptionOwner, "content-studio")
	assertCollectionSlugs(t, db, recreatedOwner, "passage")
	assertCollectionSlugs(t, db, lookalikeOwner, "content-studio", "operating-context", "passage", "research")
	assertNoCollections(t, db, partialOwner)
}

func TestRemoveSeededCollectionsFreshInstallAndNewUsersHaveNoStoredCollections(t *testing.T) {
	db := isolatedMigrationDatabase(t)
	ctx := context.Background()
	if _, err := Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	assertSeedObjectsRemoved(t, db)

	ownerID := insertMigrationUser(t, db, "cleanup-fresh@example.com")
	assertNoCollections(t, db, ownerID)

	var collectionID string
	if err := db.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title, description)
		VALUES ($1, 'intentional', 'Intentional', 'Created after cleanup.')
		RETURNING id::text
	`, ownerID).Scan(&collectionID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body, collection_id, starred)
		VALUES ($1, 'cleanup-fresh-doc', 'Fresh document', '# Fresh', $2, true)
	`, ownerID, collectionID); err != nil {
		t.Fatal(err)
	}
	assertCollectionSlugs(t, db, ownerID, "intentional")
}

func insertMigrationUser(t *testing.T, db *database.Pool, email string) string {
	t.Helper()
	var ownerID string
	if err := db.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'hash')
		RETURNING id::text
	`, email).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	return ownerID
}

func seededCollectionIDs(t *testing.T, db *database.Pool, ownerID string) map[string]string {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT slug, id::text
		FROM collections
		WHERE owner_user_id = $1
	`, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	ids := map[string]string{}
	for rows.Next() {
		var slug, id string
		if err := rows.Scan(&slug, &id); err != nil {
			t.Fatal(err)
		}
		ids[slug] = id
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return ids
}

func migrationDocumentSnapshots(t *testing.T, db *database.Pool, ownerID string) map[string]documentSnapshot {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT id::text, (to_jsonb(documents) - 'collection_id')::text,
		       md5(body), collection_id::text
		FROM documents
		WHERE owner_user_id = $1
		ORDER BY id
	`, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	snapshots := map[string]documentSnapshot{}
	for rows.Next() {
		var id string
		var snapshot documentSnapshot
		if err := rows.Scan(&id, &snapshot.withoutCollection, &snapshot.bodyMD5, &snapshot.collectionID); err != nil {
			t.Fatal(err)
		}
		snapshots[id] = snapshot
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return snapshots
}

func assertSeedObjectsRemoved(t *testing.T, db *database.Pool) {
	t.Helper()
	ctx := context.Background()
	var triggerExists, functionExists bool
	if err := db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_trigger
			WHERE tgrelid = 'users'::regclass
			  AND tgname = 'users_create_default_collections'
			  AND NOT tgisinternal
		)
	`).Scan(&triggerExists); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_proc
			WHERE proname = 'create_default_collections_for_user'
			  AND pg_function_is_visible(oid)
		)
	`).Scan(&functionExists); err != nil {
		t.Fatal(err)
	}
	if triggerExists || functionExists {
		t.Fatalf("seed objects remain: trigger=%v function=%v", triggerExists, functionExists)
	}
	var indexDefinition string
	if err := db.QueryRow(ctx, `
		SELECT indexdef
		FROM pg_indexes
		WHERE schemaname = current_schema()
		  AND indexname = 'documents_collection_id_fk_idx'
	`).Scan(&indexDefinition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(indexDefinition, "USING btree (collection_id)") || !strings.Contains(indexDefinition, "collection_id IS NOT NULL") {
		t.Fatalf("collection foreign-key index definition = %q", indexDefinition)
	}
}

func assertCollectionSlugs(t *testing.T, db *database.Pool, ownerID string, want ...string) {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT slug FROM collections WHERE owner_user_id = $1 ORDER BY slug
	`, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			t.Fatal(err)
		}
		got = append(got, slug)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collection slugs = %q, want %q", got, want)
	}
}

func TestSeedTimestampProvenanceAssumption(t *testing.T) {
	db := isolatedMigrationDatabase(t)
	ctx := context.Background()
	applyBeforeMigration(t, db, "025_remove_seeded_collections.sql")
	ownerID := insertMigrationUser(t, db, fmt.Sprintf("cleanup-timestamp-%d@example.com", time.Now().UnixNano()))

	var distinctSeedTimestamps, matchedUserTimestamp int
	if err := db.QueryRow(ctx, `
		SELECT count(DISTINCT collections.created_at),
		       count(*) FILTER (WHERE collections.created_at = users.created_at)
		FROM collections
		JOIN users ON users.id = collections.owner_user_id
		WHERE collections.owner_user_id = $1
	`, ownerID).Scan(&distinctSeedTimestamps, &matchedUserTimestamp); err != nil {
		t.Fatal(err)
	}
	if distinctSeedTimestamps != 1 || matchedUserTimestamp != len(seededCollectionDefinitions) {
		t.Fatalf("trigger provenance = %d timestamps, %d user matches", distinctSeedTimestamps, matchedUserTimestamp)
	}
}
