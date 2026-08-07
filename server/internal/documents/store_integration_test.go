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
