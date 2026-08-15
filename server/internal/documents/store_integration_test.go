package documents

import (
	"context"
	"errors"
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
		{"11111111-1111-1111-1111-111111111111", ownerID, "# One", false},
		{"11111111-1111-1111-1111-111111111112", ownerID, "---\ntags: [agents, notes]\n---\n\n# Two", false},
		{"11111111-1111-1111-1111-111111111113", ownerID, strings.Repeat("x", 5000), false},
		{"11111111-1111-1111-1111-111111111114", ownerID, "# Archived", true},
		{"11111111-1111-1111-1111-111111111115", otherID, "# Other owner", false},
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
		if _, err := db.Exec(ctx, `
			INSERT INTO documents (id, owner_user_id, public_id, title, body, archived_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, document.id, document.ownerID, fmt.Sprintf("public%d%016d", index, stamp%1_000_000_000_000_0000), storedTitle, document.body, archivedAt, updatedAt); err != nil {
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

func TestStoreSearchCoversFullBodiesRankingScopesAndIsolation(t *testing.T) {
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
	var researchID string
	if err := db.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title)
		VALUES ($1, 'research', 'Research')
		RETURNING id::text
	`, ownerID).Scan(&researchID); err != nil {
		t.Fatal(err)
	}
	var otherCollectionID string
	if err := db.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title)
		VALUES ($1, 'research', 'Research')
		RETURNING id::text
	`, otherID).Scan(&otherCollectionID); err != nil {
		t.Fatal(err)
	}

	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	type insertedDocument struct {
		id           string
		title        string
		body         string
		ownerID      string
		collectionID *string
		archived     bool
		updated      time.Time
	}
	documents := []insertedDocument{
		{title: "Agent workflow", body: "# Different heading\n\nRelease checklist.", ownerID: ownerID, updated: updatedAt},
		{title: "Body match", body: "# Body match\n\nThe agent workflow is documented here.", ownerID: ownerID, collectionID: &researchID, updated: updatedAt},
		{title: "Deep match", body: "---\ntags: [deepmarker, notes]\n---\n\n# Deep match\n\n" + strings.Repeat("padding ", 700) + "Hidden agent workflow marker.", ownerID: ownerID, collectionID: &researchID, updated: updatedAt.Add(-time.Minute)},
		{title: "Split terms", body: "# Split terms\n\nAgent flexible workflow notes.", ownerID: ownerID, updated: updatedAt.Add(-2 * time.Minute)},
		{title: "Retired workflow", body: "# Retired\n\nAgent workflow retired.", ownerID: ownerID, updated: updatedAt.Add(-3 * time.Minute)},
		{title: "Archived match", body: "# Archived\n\nAgent workflow hidden.", ownerID: ownerID, archived: true, updated: updatedAt},
		{title: "Other owner", body: "# Other owner\n\nAgent workflow private.", ownerID: otherID, collectionID: &otherCollectionID, updated: updatedAt},
	}
	for index := range documents {
		document := &documents[index]
		var archivedAt *time.Time
		if document.archived {
			archivedAt = &document.updated
		}
		if err := db.QueryRow(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body, collection_id, archived_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id::text
		`, document.ownerID, fmt.Sprintf("search%016d%02d", stamp%1_000_000_000_000_0000, index), document.title, document.body, document.collectionID, archivedAt, document.updated).Scan(&document.id); err != nil {
			t.Fatal(err)
		}
	}

	store := NewStore(db)
	global, err := store.Search(ctx, ownerID, "agent workflow", SearchScope{}, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(global) != 5 {
		t.Fatalf("global result IDs = %v, want five owned active all-term matches", searchResultIDs(global))
	}
	if global[0].ID != documents[0].id || global[0].Rank <= global[1].Rank {
		t.Fatalf("title result/rank = %q/%f, next rank %f", global[0].ID, global[0].Rank, global[1].Rank)
	}
	deep := searchResultByID(global, documents[2].id)
	if deep == nil || !strings.Contains(strings.ToLower(deep.MatchExcerpt), "agent workflow") {
		t.Fatalf("deep result = %+v", deep)
	}
	if len([]rune(deep.MatchExcerpt)) > 240 || strings.Contains(deep.MatchExcerpt, "<<<passage>>>") {
		t.Fatalf("deep match excerpt = %q", deep.MatchExcerpt)
	}
	if strings.Join(deep.Tags, ",") != "deepmarker,notes" {
		t.Fatalf("deep tags = %q", deep.Tags)
	}

	collectionResults, err := store.Search(ctx, ownerID, "agent workflow", SearchScope{CollectionID: &researchID}, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := searchResultIDs(collectionResults); len(got) != 2 || got[0] != documents[1].id || got[1] != documents[2].id {
		t.Fatalf("collection result IDs = %v", got)
	}
	unfiledResults, err := store.Search(ctx, ownerID, "agent workflow", SearchScope{Unfiled: true}, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(unfiledResults) != 3 {
		t.Fatalf("unfiled result IDs = %v", searchResultIDs(unfiledResults))
	}
	for _, result := range unfiledResults {
		if result.CollectionID != nil {
			t.Fatalf("unfiled result %q has collection %v", result.ID, result.CollectionID)
		}
	}

	phraseResults, err := store.Search(ctx, ownerID, `"agent workflow"`, SearchScope{}, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if searchResultByID(phraseResults, documents[3].id) != nil {
		t.Fatalf("phrase query matched split terms: %v", searchResultIDs(phraseResults))
	}
	exclusionResults, err := store.Search(ctx, ownerID, "agent -retired", SearchScope{}, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if searchResultByID(exclusionResults, documents[4].id) != nil || len(exclusionResults) != 4 {
		t.Fatalf("exclusion result IDs = %v", searchResultIDs(exclusionResults))
	}
	tagResults, err := store.Search(ctx, ownerID, "deepmarker", SearchScope{}, 20, nil)
	if err != nil || len(tagResults) != 1 || tagResults[0].ID != documents[2].id {
		t.Fatalf("frontmatter tag results/error = %v/%v", searchResultIDs(tagResults), err)
	}

	if _, err := store.Search(ctx, ownerID, "agent", SearchScope{CollectionID: &otherCollectionID}, 20, nil); !errors.Is(err, ErrCollectionNotFound) {
		t.Fatalf("cross-owner collection error = %v", err)
	}
	missingCollectionID := "99999999-9999-9999-9999-999999999999"
	if _, err := store.Search(ctx, ownerID, "agent", SearchScope{CollectionID: &missingCollectionID}, 20, nil); !errors.Is(err, ErrCollectionNotFound) {
		t.Fatalf("missing collection error = %v", err)
	}
	if _, err := store.Search(ctx, ownerID, "!!!", SearchScope{}, 20, nil); !errors.Is(err, ErrEmptySearchQuery) {
		t.Fatalf("empty parsed query error = %v", err)
	}
}

func TestStoreSearchUsesDeterministicKeysetPaginationAndTracksWrites(t *testing.T) {
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
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("search-pages-%d@example.com", time.Now().UnixNano()))
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID) })
	store := NewStore(db)
	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	const paginationBody = "# Pagination result\n\nStable marker."
	for index := 0; index < 7; index++ {
		if _, err := db.Exec(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body, updated_at)
			VALUES ($1, $2, 'Pagination result', $3, $4)
		`, ownerID, fmt.Sprintf("page%017d", index), paginationBody, updatedAt); err != nil {
			t.Fatal(err)
		}
	}

	var all []SearchResult
	var cursor *SearchCursor
	for {
		page, err := store.Search(ctx, ownerID, "stable marker", SearchScope{}, 3, cursor)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, page...)
		if len(page) < 3 {
			break
		}
		last := page[len(page)-1]
		cursor = &SearchCursor{Rank: last.Rank, UpdatedAt: last.UpdatedAt, ID: last.ID}
	}
	if len(all) != 7 {
		t.Fatalf("paginated results = %v", searchResultIDs(all))
	}
	seen := map[string]bool{}
	for index, result := range all {
		if seen[result.ID] {
			t.Fatalf("duplicate result %q", result.ID)
		}
		seen[result.ID] = true
		if index > 0 && all[index-1].ID < result.ID {
			t.Fatalf("IDs are not descending at %q then %q", all[index-1].ID, result.ID)
		}
	}

	document, err := store.Create(ctx, ownerID, "# Generated vector\n\nOriginal marker.", NoSavedDocumentLimit)
	if err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "original", SearchScope{}, 10, nil); err != nil || searchResultByID(results, document.ID) == nil {
		t.Fatalf("created search results/error = %v/%v", searchResultIDs(results), err)
	}
	replacement := "# Generated vector\n\nReplacement marker."
	if _, err := store.Update(ctx, ownerID, document.ID, DocumentUpdate{Body: &replacement}); err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "original", SearchScope{}, 10, nil); err != nil || searchResultByID(results, document.ID) != nil {
		t.Fatalf("stale vector results/error = %v/%v", searchResultIDs(results), err)
	}
	if results, err := store.Search(ctx, ownerID, "replacement", SearchScope{}, 10, nil); err != nil || searchResultByID(results, document.ID) == nil {
		t.Fatalf("updated vector results/error = %v/%v", searchResultIDs(results), err)
	}
}

func TestDocumentSearchPlanUsesGINIndexForMultiThousandDocumentFixture(t *testing.T) {
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
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("search-plan-%d@example.com", time.Now().UnixNano()))
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID) })
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body)
		SELECT
			$1::uuid,
			'plan-' || md5(($1::uuid)::text || generated::text),
			CASE WHEN generated = 5000 THEN 'Indexed search needle' ELSE 'Ordinary note' END,
			CASE
				WHEN generated = 5000 THEN 'Rare full text marker'
				ELSE 'Common fixture content ' || repeat(md5(generated::text) || ' ', 100)
			END
		FROM generate_series(1, 5000) AS generated
	`, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `ANALYZE documents`); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(ctx, `
		EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
		SELECT id
		FROM documents
		WHERE owner_user_id = $1
		  AND archived_at IS NULL
		  AND search_vector @@ websearch_to_tsquery('simple'::regconfig, 'indexed needle')
	`, ownerID)
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
		t.Fatalf("query plan does not use GIN search index:\n%s", plan.String())
	}
	t.Logf("representative search plan:\n%s", plan.String())
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
