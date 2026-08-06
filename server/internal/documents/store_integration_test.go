package documents

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestStoreListPageIsBoundedOrderedAndOwnerScoped(t *testing.T) {
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

	ctx := context.Background()
	stamp := time.Now().UnixNano()
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("docs-%d@example.com", stamp))
	otherID := insertDocumentTestUser(t, db, fmt.Sprintf("other-docs-%d@example.com", stamp))
	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	documents := []struct {
		id       string
		ownerID  string
		body     string
		archived bool
	}{
		{ownerID: ownerID, body: "# One"},
		{ownerID: ownerID, body: "---\ntags: [agents, notes]\n---\n\n# Two"},
		{ownerID: ownerID, body: strings.Repeat("x", 5000)},
		{ownerID: ownerID, body: "# Archived", archived: true},
		{ownerID: otherID, body: "# Other owner"},
	}
	for index, document := range documents {
		var archivedAt *time.Time
		if document.archived {
			archivedAt = &updatedAt
		}
		storedTitle := titleOf(document.body)
		if index == 1 {
			storedTitle = "---"
		}
		documentUpdatedAt := updatedAt.Add(time.Duration(index) * time.Second)
		if err := db.QueryRow(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body, archived_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id::text
		`, document.ownerID, fmt.Sprintf("public%d%016d", index, stamp%1_000_000_000_000_0000), storedTitle, document.body, archivedAt, documentUpdatedAt).Scan(&documents[index].id); err != nil {
			t.Fatal(err)
		}
	}

	store := NewStore(db)
	first, err := store.ListPage(ctx, ownerID, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 || first[0].ID != documents[2].id || first[1].ID != documents[1].id {
		t.Fatalf("first page IDs = %v", metadataIDs(first))
	}
	if len(first[0].Excerpt) != 4096 {
		t.Fatalf("excerpt length = %d", len(first[0].Excerpt))
	}
	if strings.Join(first[1].Tags, ",") != "agents,notes" {
		t.Fatalf("tags = %q", first[1].Tags)
	}
	if first[1].Title != "Two" {
		t.Fatalf("frontmatter-aware title = %q", first[1].Title)
	}

	second, err := store.ListPage(ctx, ownerID, 2, &ListCursor{UpdatedAt: first[1].UpdatedAt, ID: first[1].ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 || second[0].ID != documents[0].id {
		t.Fatalf("second page IDs = %v", metadataIDs(second))
	}
}

func TestStoreSearchIsRankedBoundedAndOwnerScoped(t *testing.T) {
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

	ctx := context.Background()
	stamp := time.Now().UnixNano()
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("search-%d@example.com", stamp))
	otherID := insertDocumentTestUser(t, db, fmt.Sprintf("other-search-%d@example.com", stamp))
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{ownerID, otherID})
	})
	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	type insertedDocument struct {
		id       string
		title    string
		body     string
		shared   bool
		archived bool
		ownerID  string
		updated  time.Time
	}
	documents := []insertedDocument{
		{title: "Agent workflow", body: "# Different heading\n\nRelease checklist.", ownerID: ownerID, updated: updatedAt},
		{title: "Body match", body: "# Body match\n\nThe agent workflow is documented here.", ownerID: ownerID, updated: updatedAt},
		{title: "Deep match", body: "---\ntags: [agents, notes]\n---\n\n# Deep match\n\n" + strings.Repeat("padding ", 700) + "Hidden Agent Workflow marker.", ownerID: ownerID, updated: updatedAt.Add(-time.Minute)},
		{title: "Shared match", body: "# Shared match\n\nAgent workflow for clients.", shared: true, ownerID: ownerID, updated: updatedAt.Add(-2 * time.Minute)},
		{title: "Archived match", body: "# Archived match\n\nAgent workflow retired.", archived: true, ownerID: ownerID, updated: updatedAt},
		{title: "Other owner", body: "# Other owner\n\nAgent workflow private.", ownerID: otherID, updated: updatedAt},
		{title: "Missing term", body: "# Missing term\n\nWorkflow without the required first word.", ownerID: ownerID, updated: updatedAt},
	}
	for index := range documents {
		document := &documents[index]
		var sharedAt *time.Time
		var archivedAt *time.Time
		if document.shared {
			sharedAt = &document.updated
		}
		if document.archived {
			archivedAt = &document.updated
		}
		if err := db.QueryRow(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body, shared_at, archived_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id::text
		`, document.ownerID, fmt.Sprintf("search%016d%02d", stamp%1_000_000_000_000_0000, index), document.title, document.body, sharedAt, archivedAt, document.updated).Scan(&document.id); err != nil {
			t.Fatal(err)
		}
	}

	store := NewStore(db)
	results, err := store.Search(ctx, ownerID, "agent work", SearchAll, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 4 {
		t.Fatalf("result IDs = %v, want four owned active all-term matches", searchResultIDs(results))
	}
	if results[0].ID != documents[0].id {
		t.Fatalf("first result = %q, want title match %q", results[0].ID, documents[0].id)
	}
	if results[0].Rank <= results[1].Rank {
		t.Fatalf("title rank %f <= body rank %f", results[0].Rank, results[1].Rank)
	}
	deep := searchResultByID(results, documents[2].id)
	if deep == nil {
		t.Fatal("deep match after 4,096 characters was not returned")
	}
	if !strings.Contains(strings.ToLower(deep.MatchExcerpt), "agent workflow") {
		t.Fatalf("deep match excerpt = %q", deep.MatchExcerpt)
	}
	if len([]rune(deep.MatchExcerpt)) > 240 {
		t.Fatalf("deep match excerpt length = %d", len([]rune(deep.MatchExcerpt)))
	}
	if strings.Contains(deep.MatchExcerpt, "passage") || strings.Contains(deep.MatchExcerpt, "<<<") {
		t.Fatalf("deep match excerpt leaked selection markers: %q", deep.MatchExcerpt)
	}
	if strings.Join(deep.Tags, ",") != "agents,notes" {
		t.Fatalf("deep match tags = %q", deep.Tags)
	}

	privateResults, err := store.Search(ctx, ownerID, "AGENT workflow", SearchPrivate, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(privateResults) != 3 || searchResultByID(privateResults, documents[3].id) != nil {
		t.Fatalf("private result IDs = %v", searchResultIDs(privateResults))
	}
	sharedResults, err := store.Search(ctx, ownerID, "agent workflow", SearchShared, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(sharedResults) != 1 || sharedResults[0].ID != documents[3].id {
		t.Fatalf("shared result IDs = %v", searchResultIDs(sharedResults))
	}
	empty, err := store.Search(ctx, ownerID, "!!!", SearchAll, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("punctuation-only results = %v", searchResultIDs(empty))
	}
	quoted, err := store.Search(ctx, ownerID, `"agent" | work`, SearchAll, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(quoted) != len(results) {
		t.Fatalf("plain quote/operator result IDs = %v", searchResultIDs(quoted))
	}

	firstPage, err := store.Search(ctx, ownerID, "agent workflow", SearchAll, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("first page length = %d", len(firstPage))
	}
	last := firstPage[len(firstPage)-1]
	secondPage, err := store.Search(ctx, ownerID, "agent workflow", SearchAll, 10, &SearchCursor{Rank: last.Rank, UpdatedAt: last.UpdatedAt, ID: last.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(secondPage) != 2 {
		t.Fatalf("second page IDs = %v", searchResultIDs(secondPage))
	}
	seen := map[string]bool{}
	for _, result := range append(firstPage, secondPage...) {
		if seen[result.ID] {
			t.Fatalf("duplicate paginated result %q", result.ID)
		}
		seen[result.ID] = true
	}
}

func TestStoreSearchTracksDocumentWritesTransactionally(t *testing.T) {
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

	ctx := context.Background()
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("search-writes-%d@example.com", time.Now().UnixNano()))
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID)
	})
	store := NewStore(db)
	document, err := store.Create(ctx, ownerID, "# Searchable\n\nOriginal marker.", NoSavedDocumentLimit)
	if err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "original", SearchAll, 10, nil); err != nil || len(results) != 1 || results[0].ID != document.ID {
		t.Fatalf("created search results/error = %v/%v", searchResultIDs(results), err)
	}
	if _, err := store.Update(ctx, ownerID, document.ID, "# Searchable\n\nReplacement marker."); err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "original", SearchAll, 10, nil); err != nil || len(results) != 0 {
		t.Fatalf("old term results/error = %v/%v", searchResultIDs(results), err)
	}
	if results, err := store.Search(ctx, ownerID, "replacement", SearchAll, 10, nil); err != nil || len(results) != 1 || results[0].ID != document.ID {
		t.Fatalf("updated search results/error = %v/%v", searchResultIDs(results), err)
	}
	if err := store.Archive(ctx, ownerID, document.ID); err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "replacement", SearchAll, 10, nil); err != nil || len(results) != 0 {
		t.Fatalf("archived search results/error = %v/%v", searchResultIDs(results), err)
	}
}

func TestDocumentSearchMigrationCreatesUsablePartialGINIndex(t *testing.T) {
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

	ctx := context.Background()
	var definition string
	if err := db.QueryRow(ctx, `
		SELECT indexdef
		FROM pg_indexes
		WHERE schemaname = current_schema()
		  AND indexname = 'documents_active_search_idx'
	`).Scan(&definition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(definition, "USING gin") || !strings.Contains(definition, "archived_at IS NULL") {
		t.Fatalf("search index definition = %q", definition)
	}
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("search-plan-%d@example.com", time.Now().UnixNano()))
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID)
	})
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body)
		SELECT
			$1::uuid,
			'plan-' || md5(($1::uuid)::text || generated::text),
			CASE WHEN generated = 500 THEN 'Agent marker' ELSE 'Ordinary note' END,
			CASE WHEN generated = 500 THEN 'Indexed agent content' ELSE 'Unrelated document content' END
		FROM generate_series(1, 500) AS generated
	`, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `ANALYZE documents`); err != nil {
		t.Fatal(err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL enable_seqscan = off`); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(ctx, `
		EXPLAIN (COSTS OFF)
		SELECT id
		FROM documents
		WHERE archived_at IS NULL
		  AND (
			setweight(to_tsvector('simple'::regconfig, title), 'A') ||
			setweight(to_tsvector('simple'::regconfig, body), 'B')
		  ) @@ to_tsquery('simple'::regconfig, 'agent:*')
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "documents_active_search_idx") {
		t.Fatalf("query plan does not use search index:\n%s", plan.String())
	}
}

func insertDocumentTestUser(t *testing.T, db *database.Pool, email string) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `INSERT INTO users (email, password_hash) VALUES ($1, 'hash') RETURNING id::text`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func metadataIDs(documents []DocumentMetadata) []string {
	ids := make([]string, len(documents))
	for index, document := range documents {
		ids[index] = document.ID
	}
	return ids
}

func searchResultIDs(results []SearchResult) []string {
	ids := make([]string, len(results))
	for index, result := range results {
		ids[index] = result.ID
	}
	return ids
}

func searchResultByID(results []SearchResult, id string) *SearchResult {
	for index := range results {
		if results[index].ID == id {
			return &results[index]
		}
	}
	return nil
}
