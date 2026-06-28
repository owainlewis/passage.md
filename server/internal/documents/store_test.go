package documents

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestTitleOf(t *testing.T) {
	tests := map[string]string{
		"# Launch note\n\nBody":  "Launch note",
		"   \nUntitled body":     "Untitled body",
		"":                       "Untitled",
		strings.Repeat("é", 121): strings.Repeat("é", 120),
	}

	for input, want := range tests {
		if got := titleOf(input); got != want {
			t.Fatalf("titleOf(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestStoreRejectsMalformedDocumentIDsWithoutDatabase(t *testing.T) {
	store := &Store{}

	if _, err := store.Get(context.Background(), "user-1", "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get error = %v, want %v", err, ErrNotFound)
	}
	if _, err := store.Update(context.Background(), "user-1", "not-a-uuid", "# One"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update error = %v, want %v", err, ErrNotFound)
	}
	if err := store.Archive(context.Background(), "user-1", "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Archive error = %v, want %v", err, ErrNotFound)
	}
	if _, err := store.Share(context.Background(), "user-1", "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Share error = %v, want %v", err, ErrNotFound)
	}
	if err := store.Unshare(context.Background(), "user-1", "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Unshare error = %v, want %v", err, ErrNotFound)
	}
	if _, err := store.GetPublic(context.Background(), "not-a-token"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetPublic error = %v, want %v", err, ErrNotFound)
	}
}

func TestValidUUID(t *testing.T) {
	if !validUUID("11111111-1111-1111-1111-111111111111") {
		t.Fatal("validUUID rejected a valid UUID shape")
	}
	if validUUID("not-a-uuid") {
		t.Fatal("validUUID accepted a malformed UUID")
	}
}

func TestShareTokens(t *testing.T) {
	token, err := randomShareToken()
	if err != nil {
		t.Fatal(err)
	}
	if !validShareToken(token) {
		t.Fatalf("randomShareToken returned invalid token %q", token)
	}
	if validShareToken(strings.Repeat("a", 42)) {
		t.Fatal("validShareToken accepted the wrong length")
	}
	if validShareToken(strings.Repeat("a", 42) + "!") {
		t.Fatal("validShareToken accepted an invalid character")
	}
}
