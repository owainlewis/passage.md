package database

import (
	"context"
	"strings"
	"testing"
)

func TestOpenRejectsInvalidMaximumConnections(t *testing.T) {
	_, err := Open(context.Background(), "postgres://example", 0)
	if err == nil || !strings.Contains(err.Error(), "must be greater than zero") {
		t.Fatalf("Open error = %v", err)
	}

	_, err = Open(context.Background(), "postgres://example", 1, 2)
	if err == nil || !strings.Contains(err.Error(), "accepts one override") {
		t.Fatalf("Open multiple overrides error = %v", err)
	}
}
