package web

import (
	"os"
	"strings"
	"testing"
)

func TestEmbedPatternIncludesNextBuildAssets(t *testing.T) {
	source, err := os.ReadFile("web.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), "//go:embed all:dist") {
		t.Fatal("embedded frontend must use all:dist so Go includes _next build assets")
	}
}
