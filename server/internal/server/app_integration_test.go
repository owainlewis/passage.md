package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestAPITokenDocumentRoutesWithPostgres(t *testing.T) {
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}}, db)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	userOneCookies := registerIntegrationUser(t, server.URL, "token-one@example.com")
	userTwoCookies := registerIntegrationUser(t, server.URL, "token-two@example.com")

	tokenBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/api-tokens", `{"name":"Integration"}`, userOneCookies, "")
	var tokenResponse struct {
		Token    string `json:"token"`
		APIToken struct {
			ID string `json:"id"`
		} `json:"apiToken"`
	}
	if err := json.Unmarshal([]byte(tokenBody), &tokenResponse); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tokenResponse.Token, "psg_") {
		t.Fatalf("token = %q, want psg_ prefix", tokenResponse.Token)
	}
	listBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/api-tokens", "", userOneCookies, "")
	if strings.Contains(listBody, tokenResponse.Token) {
		t.Fatalf("token list leaked plaintext token: %s", listBody)
	}

	docBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Bearer integration"}`, nil, tokenResponse.Token)
	var docResponse struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(docBody), &docResponse); err != nil {
		t.Fatal(err)
	}
	if docResponse.ID == "" {
		t.Fatalf("document create body = %s", docBody)
	}
	doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs", "", nil, tokenResponse.Token)
	doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/"+docResponse.ID, "", nil, tokenResponse.Token)
	doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+docResponse.ID, `{"body":"# Updated bearer integration"}`, nil, tokenResponse.Token)

	otherDocBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Other owner"}`, userTwoCookies, "")
	var otherDocResponse struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(otherDocBody), &otherDocResponse); err != nil {
		t.Fatal(err)
	}
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/docs/"+otherDocResponse.ID, "", nil, tokenResponse.Token); got != http.StatusNotFound {
		t.Fatalf("other owner get status = %d, want %d", got, http.StatusNotFound)
	}

	doIntegrationRequest(t, http.MethodDelete, server.URL+"/api/v1/api-tokens/"+tokenResponse.APIToken.ID, "", userOneCookies, "")
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/docs", "", nil, tokenResponse.Token); got != http.StatusUnauthorized {
		t.Fatalf("revoked token status = %d, want %d", got, http.StatusUnauthorized)
	}
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/docs", "", nil, ""); got != http.StatusUnauthorized {
		t.Fatalf("anonymous docs status = %d, want %d", got, http.StatusUnauthorized)
	}
}

func registerIntegrationUser(t *testing.T, baseURL string, email string) []*http.Cookie {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/auth/register", strings.NewReader(`{"email":"`+email+`","password":"password123"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register status = %d", res.StatusCode)
	}
	return res.Cookies()
}

func doIntegrationRequest(t *testing.T, method string, url string, body string, cookies []*http.Cookie, bearer string) string {
	t.Helper()
	resBody, status := doIntegrationRequestRaw(t, method, url, body, cookies, bearer)
	if status < 200 || status >= 300 {
		t.Fatalf("%s %s status = %d, body = %s", method, url, status, resBody)
	}
	return resBody
}

func doIntegrationStatus(t *testing.T, method string, url string, body string, cookies []*http.Cookie, bearer string) int {
	t.Helper()
	_, status := doIntegrationRequestRaw(t, method, url, body, cookies, bearer)
	return status
}

func doIntegrationRequestRaw(t *testing.T, method string, url string, body string, cookies []*http.Cookie, bearer string) (string, int) {
	t.Helper()
	reqBody := strings.NewReader(body)
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(responseBody), res.StatusCode
}
