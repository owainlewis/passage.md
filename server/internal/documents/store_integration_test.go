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
	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	type insertedDocument struct {
		id       string
		title    string
		body     string
		ownerID  string
		archived bool
		updated  time.Time
	}
	documents := []insertedDocument{
		{title: "Agent workflow", body: "# Different heading\n\nRelease checklist.", ownerID: ownerID, updated: updatedAt},
		{title: "Body match", body: "# Body match\n\nThe agent workflow is documented here.", ownerID: ownerID, updated: updatedAt},
		{title: "Deep match", body: "---\ntags: [deepmarker, notes]\n---\n\n# Deep match\n\n" + strings.Repeat("padding ", 700) + "Hidden agent workflow marker.", ownerID: ownerID, updated: updatedAt.Add(-time.Minute)},
		{title: "Split terms", body: "# Split terms\n\nAgent flexible workflow notes.", ownerID: ownerID, updated: updatedAt.Add(-2 * time.Minute)},
		{title: "Retired workflow", body: "# Retired\n\nAgent workflow retired.", ownerID: ownerID, updated: updatedAt.Add(-3 * time.Minute)},
		{title: "Archived match", body: "# Archived\n\nAgent workflow hidden.", ownerID: ownerID, archived: true, updated: updatedAt},
		{title: "Other owner", body: "# Other owner\n\nAgent workflow private.", ownerID: otherID, updated: updatedAt},
	}
	for index := range documents {
		document := &documents[index]
		var archivedAt *time.Time
		if document.archived {
			archivedAt = &document.updated
		}
		if err := db.QueryRow(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body, archived_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id::text
		`, document.ownerID, fmt.Sprintf("search%016d%02d", stamp%1_000_000_000_000_0000, index), document.title, document.body, archivedAt, document.updated).Scan(&document.id); err != nil {
			t.Fatal(err)
		}
	}

	store := NewStore(db)
	global, err := store.Search(ctx, ownerID, "agent workflow", 20, nil)
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

	phraseResults, err := store.Search(ctx, ownerID, `"agent workflow"`, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if searchResultByID(phraseResults, documents[3].id) != nil {
		t.Fatalf("phrase query matched split terms: %v", searchResultIDs(phraseResults))
	}
	exclusionResults, err := store.Search(ctx, ownerID, "agent -retired", 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if searchResultByID(exclusionResults, documents[4].id) != nil || len(exclusionResults) != 4 {
		t.Fatalf("exclusion result IDs = %v", searchResultIDs(exclusionResults))
	}
	tagResults, err := store.Search(ctx, ownerID, "deepmarker", 20, nil)
	if err != nil || len(tagResults) != 1 || tagResults[0].ID != documents[2].id {
		t.Fatalf("frontmatter tag results/error = %v/%v", searchResultIDs(tagResults), err)
	}

	if _, err := store.Search(ctx, ownerID, "!!!", 20, nil); !errors.Is(err, ErrEmptySearchQuery) {
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
		page, err := store.Search(ctx, ownerID, "stable marker", 3, cursor)
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

	document, err := store.Create(ctx, ownerID, "# Generated vector\n\nOriginal marker.", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "original", 10, nil); err != nil || searchResultByID(results, document.ID) == nil {
		t.Fatalf("created search results/error = %v/%v", searchResultIDs(results), err)
	}
	replacement := "# Generated vector\n\nReplacement marker."
	if _, err := store.Update(ctx, ownerID, document.ID, DocumentUpdate{Body: &replacement}); err != nil {
		t.Fatal(err)
	}
	if results, err := store.Search(ctx, ownerID, "original", 10, nil); err != nil || searchResultByID(results, document.ID) != nil {
		t.Fatalf("stale vector results/error = %v/%v", searchResultIDs(results), err)
	}
	if results, err := store.Search(ctx, ownerID, "replacement", 10, nil); err != nil || searchResultByID(results, document.ID) == nil {
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

func TestStoreContentVersionGuardsConcurrentWrites(t *testing.T) {
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
	store := NewStore(db)
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("version-%d@example.com", time.Now().UnixNano()))

	created, err := store.Create(ctx, ownerID, "# Start", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	if created.Version != 1 {
		t.Fatalf("new document version = %d, want 1", created.Version)
	}

	body := "# Start\n\nfirst writer"
	first, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Body: &body, IfVersion: &created.Version})
	if err != nil {
		t.Fatal(err)
	}
	if first.Version != 2 {
		t.Fatalf("version after update = %d, want 2", first.Version)
	}

	// The second writer still holds version 1, so it must lose rather than
	// overwrite the first writer's body.
	stale := "# Start\n\nsecond writer"
	if _, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Body: &stale, IfVersion: &created.Version}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error = %v, want ErrVersionConflict", err)
	}

	after, err := store.Get(ctx, ownerID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Body != body {
		t.Fatalf("body after rejected write = %q, want %q", after.Body, body)
	}
	if after.Version != 2 {
		t.Fatalf("version after rejected write = %d, want 2", after.Version)
	}
	if !after.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("rejected write moved updated_at from %v to %v", first.UpdatedAt, after.UpdatedAt)
	}

	// Omitting the version keeps the old unconditional behaviour for existing
	// API clients, and still advances the version for everyone else.
	legacy := "# Start\n\nlegacy client"
	unconditional, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Body: &legacy})
	if err != nil {
		t.Fatal(err)
	}
	if unconditional.Version != 3 {
		t.Fatalf("version after unconditional update = %d, want 3", unconditional.Version)
	}

	// Metadata-only writes are not content changes, so they leave the version
	// alone and a held version stays usable.
	starred := true
	metadata, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Starred: &starred, IfVersion: &unconditional.Version})
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Version != 3 {
		t.Fatalf("version after metadata update = %d, want 3", metadata.Version)
	}
	if !metadata.Starred {
		t.Fatal("metadata update did not persist the star")
	}
}

func TestStoreAttributesContentWritesToTheActingIdentity(t *testing.T) {
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
	store := NewStore(db)
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("attribution-%d@example.com", time.Now().UnixNano()))
	agent := Actor{TokenID: "11111111-1111-1111-1111-111111111111", TokenName: "Nightly runner"}

	created, err := store.Create(ctx, ownerID, "# Shared", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	if created.LastEditor == nil || !created.LastEditor.IsOwner {
		t.Fatalf("created last editor = %#v, want the owner", created.LastEditor)
	}

	// Two owner autosaves must not become two contributors.
	for _, body := range []string{"# Shared\n\none", "# Shared\n\ntwo"} {
		if _, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Body: &body}); err != nil {
			t.Fatal(err)
		}
	}
	contributors, err := store.Contributors(ctx, ownerID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(contributors) != 1 || !contributors[0].IsOwner {
		t.Fatalf("contributors after owner autosaves = %#v, want one owner", contributors)
	}

	agentBody := "# Shared\n\nwritten by the agent"
	agentWrite, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Body: &agentBody, Actor: agent})
	if err != nil {
		t.Fatal(err)
	}
	if agentWrite.LastEditor == nil || agentWrite.LastEditor.IsOwner {
		t.Fatalf("last editor after agent write = %#v, want the token", agentWrite.LastEditor)
	}
	if agentWrite.LastEditor.Name == nil || *agentWrite.LastEditor.Name != "Nightly runner" {
		t.Fatalf("last editor name = %#v, want the token name snapshot", agentWrite.LastEditor.Name)
	}

	contributors, err = store.Contributors(ctx, ownerID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(contributors) != 2 {
		t.Fatalf("contributors = %#v, want the owner and the agent", contributors)
	}
	if contributors[0].ActorKey != agent.TokenID {
		t.Fatalf("contributors are not most-recent-first: %#v", contributors)
	}

	// Metadata is not authorship. Starring must not make the agent the last
	// editor of content it never wrote.
	starred := true
	if _, err := store.Update(ctx, ownerID, created.ID, DocumentUpdate{Starred: &starred, Actor: Actor{TokenID: "22222222-2222-2222-2222-222222222222", TokenName: "Filing bot"}}); err != nil {
		t.Fatal(err)
	}
	after, err := store.Get(ctx, ownerID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.LastEditor == nil || after.LastEditor.ActorKey != agent.TokenID {
		t.Fatalf("last editor after a metadata write = %#v, want it unchanged", after.LastEditor)
	}
	contributors, err = store.Contributors(ctx, ownerID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(contributors) != 2 {
		t.Fatalf("a metadata write added a contributor: %#v", contributors)
	}

	// The paginated list carries attribution too. It scanned the columns and
	// dropped them once, which made every list response look unattributed.
	page, err := store.ListPage(ctx, ownerID, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	var listed *DocumentMetadata
	for i := range page {
		if page[i].ID == created.ID {
			listed = &page[i]
		}
	}
	if listed == nil {
		t.Fatal("document missing from the list page")
	}
	if listed.LastEditor == nil || listed.LastEditor.ActorKey != agent.TokenID {
		t.Fatalf("list page last editor = %#v, want the agent", listed.LastEditor)
	}

	// Attribution is owner-scoped: another account cannot read who writes here.
	otherID := insertDocumentTestUser(t, db, fmt.Sprintf("attribution-other-%d@example.com", time.Now().UnixNano()))
	foreign, err := store.Contributors(ctx, otherID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(foreign) != 0 {
		t.Fatalf("contributors leaked to another owner: %#v", foreign)
	}
}

func TestStoreDerivedDocsNestOneLevelUnderAParent(t *testing.T) {
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
	store := NewStore(db)
	stamp := time.Now().UnixNano()
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("derived-%d@example.com", stamp))
	otherID := insertDocumentTestUser(t, db, fmt.Sprintf("derived-other-%d@example.com", stamp))
	marker := fmt.Sprintf("derivedmarker%d", stamp)

	parent, err := store.Create(ctx, ownerID, "# Source piece", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	if parent.ParentID != nil {
		t.Fatalf("top-level parentId = %v", *parent.ParentID)
	}
	alone, err := store.Create(ctx, ownerID, "# Standalone", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	var children []Document
	for _, body := range []string{"# Newsletter\n\n" + marker, "# LinkedIn post", "# Video script"} {
		child, err := store.Create(ctx, ownerID, body, parent.ID, NoSavedDocumentLimit, Actor{})
		if err != nil {
			t.Fatal(err)
		}
		if child.ParentID == nil || *child.ParentID != parent.ID {
			t.Fatalf("child parentId = %v, want %s", child.ParentID, parent.ID)
		}
		children = append(children, child)
	}

	// The parent must be the owner's, active, and top-level.
	otherDoc, err := store.Create(ctx, otherID, "# Someone else's", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	archivedParent, err := store.Create(ctx, ownerID, "# Gone", "", NoSavedDocumentLimit, Actor{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Archive(ctx, ownerID, archivedParent.ID, nil); err != nil {
		t.Fatal(err)
	}
	for name, parentID := range map[string]string{
		"missing":     "99999999-9999-9999-9999-999999999999",
		"malformed":   "not-a-uuid",
		"other owner": otherDoc.ID,
		"archived":    archivedParent.ID,
	} {
		if _, err := store.Create(ctx, ownerID, "# Child", parentID, NoSavedDocumentLimit, Actor{}); !errors.Is(err, ErrParentNotFound) {
			t.Fatalf("%s parent error = %v, want ErrParentNotFound", name, err)
		}
	}
	if _, err := store.Create(ctx, ownerID, "# Grandchild", children[0].ID, NoSavedDocumentLimit, Actor{}); !errors.Is(err, ErrParentIsDerived) {
		t.Fatalf("nested child error = %v, want ErrParentIsDerived", err)
	}
	// Children count toward the saved document limit like any other document.
	if _, err := store.Create(ctx, ownerID, "# Over", parent.ID, 5, Actor{}); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("child at the limit error = %v, want ErrLimitReached", err)
	}

	// A bad parent is named as the problem even when the account is full.
	if _, err := store.Create(ctx, ownerID, "# Over", "99999999-9999-9999-9999-999999999999", 1, Actor{}); !errors.Is(err, ErrParentNotFound) {
		t.Fatalf("missing parent at the limit error = %v, want ErrParentNotFound", err)
	}

	// Editing a child must not move its parent in the list.
	edited := "# Video script\n\nrevised"
	if _, err := store.Update(ctx, ownerID, children[2].ID, DocumentUpdate{Body: &edited}); err != nil {
		t.Fatal(err)
	}

	// One row per page still keeps every child with its parent.
	first, err := store.ListPage(ctx, ownerID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || first[0].ID != alone.ID || len(first[0].Children) != 0 {
		t.Fatalf("first page = %v, children %d", metadataIDs(first), len(first[0].Children))
	}
	second, err := store.ListPage(ctx, ownerID, 1, &ListCursor{UpdatedAt: first[0].UpdatedAt, ID: first[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 1 || second[0].ID != parent.ID || second[0].ParentID != nil {
		t.Fatalf("second page = %v", metadataIDs(second))
	}
	gotChildren := metadataIDs(second[0].Children)
	wantChildren := []string{children[0].ID, children[1].ID, children[2].ID}
	if strings.Join(gotChildren, ",") != strings.Join(wantChildren, ",") {
		t.Fatalf("children = %v, want oldest first %v", gotChildren, wantChildren)
	}
	for _, child := range second[0].Children {
		if child.ParentID == nil || *child.ParentID != parent.ID {
			t.Fatalf("listed child parentId = %v", child.ParentID)
		}
	}
	if second[0].Children[0].Title != "Newsletter" {
		t.Fatalf("child title = %q", second[0].Children[0].Title)
	}
	third, err := store.ListPage(ctx, ownerID, 1, &ListCursor{UpdatedAt: second[0].UpdatedAt, ID: second[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(third) != 0 {
		t.Fatalf("a child was listed as a top-level row: %v", metadataIDs(third))
	}

	// The legacy list stays flat for released CLI clients.
	all, err := store.List(ctx, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	withParent := 0
	for _, doc := range all {
		if doc.ParentID != nil {
			if *doc.ParentID != parent.ID {
				t.Fatalf("legacy parentId = %s", *doc.ParentID)
			}
			withParent++
		}
	}
	if len(all) != 5 || withParent != 3 {
		t.Fatalf("legacy list = %d documents, %d with a parent", len(all), withParent)
	}

	results, err := store.Search(ctx, ownerID, marker, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ID != children[0].ID || results[0].ParentID == nil || *results[0].ParentID != parent.ID {
		t.Fatalf("search results = %v", searchResultIDs(results))
	}

	// Archiving a child leaves its parent and siblings alone.
	if err := store.Archive(ctx, ownerID, children[1].ID, nil); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{parent.ID, children[0].ID, children[2].ID} {
		if _, err := store.Get(ctx, ownerID, id); err != nil {
			t.Fatalf("document %s after archiving a sibling: %v", id, err)
		}
	}

	// A shared child does not block its parent. It goes with it, and its
	// public URL stops resolving.
	sharedChild, err := store.Share(ctx, ownerID, children[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if sharedChild.ParentID == nil {
		t.Fatal("share dropped the child's parentId")
	}
	if _, err := store.GetPublic(ctx, sharedChild.PublicID); err != nil {
		t.Fatalf("shared child public lookup: %v", err)
	}

	// The document being deleted must still be unshared first, and a refused
	// delete leaves the children where they were.
	if _, err := store.Share(ctx, ownerID, parent.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Archive(ctx, ownerID, parent.ID, nil); !errors.Is(err, ErrShared) {
		t.Fatalf("shared parent archive error = %v, want ErrShared", err)
	}
	if _, err := store.Get(ctx, ownerID, children[2].ID); err != nil {
		t.Fatalf("child after refused parent archive: %v", err)
	}
	if err := store.Unshare(ctx, ownerID, parent.ID); err != nil {
		t.Fatal(err)
	}

	// A caller that counted the derived docs wrong archives nothing, and is
	// told how many there are.
	stale := 0
	var changed *ChildrenChangedError
	if err := store.Archive(ctx, ownerID, parent.ID, &stale); !errors.As(err, &changed) || changed.Children != 2 {
		t.Fatalf("stale count archive error = %v, want ChildrenChangedError with 2 children", err)
	}
	if _, err := store.Get(ctx, ownerID, parent.ID); err != nil {
		t.Fatalf("parent after refused archive: %v", err)
	}

	counted := 2
	if err := store.Archive(ctx, ownerID, parent.ID, &counted); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{parent.ID, children[0].ID, children[2].ID} {
		if _, err := store.Get(ctx, ownerID, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("document %s after parent archive: %v, want ErrNotFound", id, err)
		}
	}
	if _, err := store.GetPublic(ctx, sharedChild.PublicID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("archived child public lookup error = %v, want ErrNotFound", err)
	}
	if results, err := store.Search(ctx, ownerID, marker, 10, nil); err != nil || len(results) != 0 {
		t.Fatalf("search after parent archive = %v, %v", searchResultIDs(results), err)
	}
	remaining, err := store.ListPage(ctx, ownerID, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 1 || remaining[0].ID != alone.ID {
		t.Fatalf("list after parent archive = %v", metadataIDs(remaining))
	}
	if _, err := store.Get(ctx, otherID, otherDoc.ID); err != nil {
		t.Fatalf("another owner's document was touched: %v", err)
	}
}

// A child created while its parent is being archived must not survive as an
// active document under an archived parent.
func TestStoreArchiveAndDerivedCreateDoNotLeaveOrphans(t *testing.T) {
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
	store := NewStore(db)
	ownerID := insertDocumentTestUser(t, db, fmt.Sprintf("derived-race-%d@example.com", time.Now().UnixNano()))

	for round := range 20 {
		parent, err := store.Create(ctx, ownerID, "# Source", "", NoSavedDocumentLimit, Actor{})
		if err != nil {
			t.Fatal(err)
		}
		createErr := make(chan error, 1)
		archiveErr := make(chan error, 1)
		go func() {
			_, err := store.Create(ctx, ownerID, "# Child", parent.ID, NoSavedDocumentLimit, Actor{})
			createErr <- err
		}()
		go func() { archiveErr <- store.Archive(ctx, ownerID, parent.ID, nil) }()
		if err := <-archiveErr; err != nil {
			t.Fatalf("round %d archive: %v", round, err)
		}
		if err := <-createErr; err != nil && !errors.Is(err, ErrParentNotFound) {
			t.Fatalf("round %d create: %v", round, err)
		}
		var orphans int
		if err := db.QueryRow(ctx, `
			SELECT count(*) FROM documents
			WHERE parent_id = $1 AND archived_at IS NULL
		`, parent.ID).Scan(&orphans); err != nil {
			t.Fatal(err)
		}
		if orphans != 0 {
			t.Fatalf("round %d left %d active children under an archived parent", round, orphans)
		}
	}
}
