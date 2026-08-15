package collections

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/documents"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestStorePersistsOwnerScopedCollectionsMembershipAndStars(t *testing.T) {
	db := collectionTestDatabase(t)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	ownerID := insertCollectionTestUser(t, db, fmt.Sprintf("collections-%d@example.com", stamp))
	otherID := insertCollectionTestUser(t, db, fmt.Sprintf("other-collections-%d@example.com", stamp))
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{ownerID, otherID})
	})

	store := NewStore(db)
	created, err := store.Create(ctx, ownerID, "Team Notes", stringPointer("Notes shared with the team."))
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.Create(ctx, otherID, "Team Notes", nil)
	if err != nil {
		t.Fatal(err)
	}
	if created.Slug != "team-notes" || other.Slug != created.Slug {
		t.Fatalf("owner-scoped slugs = %q and %q", created.Slug, other.Slug)
	}
	ownerCollections, err := store.List(ctx, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if containsCollectionID(ownerCollections, other.ID) {
		t.Fatal("owner list exposed another owner's collection")
	}

	docStore := documents.NewStore(db)
	doc, err := docStore.Create(ctx, ownerID, "# Stable body", documents.NoSavedDocumentLimit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := docStore.Update(ctx, ownerID, doc.ID, documents.DocumentUpdate{
		CollectionIDSet: true,
		CollectionID:    &other.ID,
	}); !errors.Is(err, documents.ErrCollectionNotFound) {
		t.Fatalf("cross-owner assignment error = %v", err)
	}
	unchanged, err := docStore.Get(ctx, ownerID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.CollectionID != nil || unchanged.Body != "# Stable body" || unchanged.Starred {
		t.Fatalf("cross-owner assignment changed document: %#v", unchanged)
	}

	starred := true
	assigned, err := docStore.Update(ctx, ownerID, doc.ID, documents.DocumentUpdate{
		CollectionIDSet: true,
		CollectionID:    &created.ID,
		Starred:         &starred,
	})
	if err != nil {
		t.Fatal(err)
	}
	if assigned.CollectionSlug == nil || *assigned.CollectionSlug != "team-notes" || !assigned.Starred || assigned.Body != "# Stable body" {
		t.Fatalf("assigned document = %#v", assigned)
	}

	renamed, err := store.Update(ctx, ownerID, created.Slug, "Renamed Notes", nil)
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Slug != created.Slug {
		t.Fatalf("rename changed slug from %q to %q", created.Slug, renamed.Slug)
	}
	if err := store.Delete(ctx, ownerID, created.Slug); err != nil {
		t.Fatal(err)
	}
	moved, err := docStore.Get(ctx, ownerID, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if moved.CollectionID != nil || moved.CollectionSlug != nil || moved.Body != "# Stable body" || !moved.Starred {
		t.Fatalf("document after collection deletion = %#v", moved)
	}
	if _, err := store.Update(ctx, ownerID, created.Slug, "Missing", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update deleted collection error = %v", err)
	}
}

func TestStoreEnforcesOneHundredCollectionLimit(t *testing.T) {
	db := collectionTestDatabase(t)
	ctx := context.Background()
	ownerID := insertCollectionTestUser(t, db, fmt.Sprintf("collection-limit-%d@example.com", time.Now().UnixNano()))
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID) })

	store := NewStore(db)
	existing, err := store.List(ctx, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	for index := len(existing); index < MaxCollections; index++ {
		if _, err := store.Create(ctx, ownerID, fmt.Sprintf("Collection %d", index+1), nil); err != nil {
			t.Fatalf("create collection %d: %v", index+1, err)
		}
	}
	if _, err := store.Create(ctx, ownerID, "One too many", nil); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("collection 101 error = %v", err)
	}
}

func collectionTestDatabase(t *testing.T) *database.Pool {
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

func insertCollectionTestUser(t *testing.T, db *database.Pool, email string) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'hash')
		RETURNING id::text
	`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func stringPointer(value string) *string {
	return &value
}

func containsCollectionID(collections []Collection, id string) bool {
	for _, collection := range collections {
		if collection.ID == id {
			return true
		}
	}
	return false
}
