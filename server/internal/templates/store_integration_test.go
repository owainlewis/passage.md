package templates

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestStoreEnforcesOwnerAndTenTemplateLimit(t *testing.T) {
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
	ownerID := insertTemplateTestUser(t, db, fmt.Sprintf("templates-%d@example.com", stamp))
	otherID := insertTemplateTestUser(t, db, fmt.Sprintf("other-templates-%d@example.com", stamp))
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{ownerID, otherID})
	})

	store := NewStore(db)
	var first Template
	for index := range MaxTemplates {
		created, err := store.Create(ctx, ownerID, fmt.Sprintf("Template %d", index+1), fmt.Sprintf("Description %d", index+1), fmt.Sprintf("# Body %d", index+1))
		if err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			first = created
		}
	}
	if _, err := store.Create(ctx, ownerID, "Eleventh", "Too many", "# Too many"); err != ErrLimitReached {
		t.Fatalf("eleventh create error = %v", err)
	}
	if _, err := store.Get(ctx, otherID, first.ID); err != ErrNotFound {
		t.Fatalf("other owner get error = %v", err)
	}
	if err := store.Delete(ctx, ownerID, first.ID); err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(ctx, ownerID, "Replacement", "A replacement template.", "# Replacement")
	if err != nil {
		t.Fatal(err)
	}
	if created.Title != "Replacement" || created.Description != "A replacement template." || created.Body != "# Replacement" {
		t.Fatalf("replacement = %#v", created)
	}
	updated, err := store.Update(ctx, ownerID, created.ID, "Updated", "Updated description.", "# Updated")
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Get(ctx, ownerID, updated.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Description != "Updated description." || loaded.Body != "# Updated" {
		t.Fatalf("loaded = %#v", loaded)
	}
}

func insertTemplateTestUser(t *testing.T, db *database.Pool, email string) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `INSERT INTO users (email, password_hash) VALUES ($1, 'hash') RETURNING id::text`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
