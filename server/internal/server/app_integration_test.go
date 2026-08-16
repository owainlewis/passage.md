package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
	"github.com/owainlewis/passage.md/server/internal/policy"
	"golang.org/x/crypto/bcrypt"
)

func awaitTestValue[T any](t *testing.T, ctx context.Context, values <-chan T, description string) T {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-ctx.Done():
		t.Fatalf("timed out waiting for %s: %v", description, ctx.Err())
		var zero T
		return zero
	}
}

func testRelease(signal chan struct{}) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			close(signal)
		})
	}
}

func TestPublicSignupWithPostgres(t *testing.T) {
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

	email := fmt.Sprintf("public-signup-%d@example.com", time.Now().UnixNano())
	defer db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email)
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{
		SessionSecret:       "test-secret",
		PublicSignupEnabled: true,
		Billing:             config.BillingConfig{FreeMaxSavedDocs: 5, ProMaxSavedDocs: 1000},
	})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	req, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/v1/auth/register",
		strings.NewReader(`{"email":"`+email+`","password":"password123","policyVersion":"`+policy.CurrentVersion+`"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register status/body = %d/%s", res.StatusCode, responseBody)
	}
	cookies := res.Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatalf("session cookies = %#v", cookies)
	}

	meBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/me", "", cookies, "")
	for _, want := range []string{
		`"authenticated":true`,
		`"publicSignupEnabled":true`,
		`"policyVersion":"` + policy.CurrentVersion + `"`,
		`"plan":"free"`,
		`"source":"default"`,
		`"maxSavedDocs":5`,
	} {
		if !strings.Contains(meBody, want) {
			t.Fatalf("me body = %s, missing %s", meBody, want)
		}
	}

	var acceptedVersion string
	var acceptedAt time.Time
	if err := db.QueryRow(ctx, `
		SELECT policy_version, policy_accepted_at
		FROM users
		WHERE email = $1
	`, email).Scan(&acceptedVersion, &acceptedAt); err != nil {
		t.Fatal(err)
	}
	if acceptedVersion != policy.CurrentVersion || acceptedAt.IsZero() {
		t.Fatalf("policy acceptance = %q/%s", acceptedVersion, acceptedAt)
	}
}

func TestPasswordResetWithPostgres(t *testing.T) {
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	email := fmt.Sprintf("password-reset-%d@example.com", time.Now().UnixNano())
	sender := &integrationResetSender{sent: make(chan integrationResetEmail, 8)}
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{
		SessionSecret:       "test-secret",
		AppBaseURL:          "https://passage.md",
		PasswordResetSender: sender,
		Billing:             config.BillingConfig{FreeMaxSavedDocs: 5, ProMaxSavedDocs: 1000},
	})
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	go app.RunPasswordResetWorker(ctx)
	cookies := createIntegrationUserAndLogin(t, db, server.URL, email)
	defer db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email)
	var userID string
	if err := db.QueryRow(ctx, `SELECT id::text FROM users WHERE email = $1`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	expiredToken := fmt.Sprintf("expired-%d", time.Now().UnixNano())
	expiredSum := sha256.Sum256([]byte(expiredToken))
	if _, err := db.Exec(ctx, `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, hex.EncodeToString(expiredSum[:]), time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := doIntegrationStatus(t, http.MethodPost, server.URL+"/api/v1/auth/password-reset/confirm", `{"token":"`+expiredToken+`","password":"new-password-123"}`, nil, ""); got != http.StatusBadRequest {
		t.Fatalf("expired token status = %d", got)
	}

	knownBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/auth/password-reset/request", `{"email":"`+email+`"}`, nil, "")
	unknownBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/auth/password-reset/request", `{"email":"unknown-`+email+`"}`, nil, "")
	if knownBody != unknownBody || !strings.Contains(knownBody, "If an account exists") {
		t.Fatalf("known response = %q, unknown response = %q", knownBody, unknownBody)
	}

	var resetURL string
	deadline := time.After(8 * time.Second)
	for resetURL == "" {
		select {
		case delivered := <-sender.sent:
			if delivered.email == email {
				resetURL = delivered.resetURL
			}
		case <-deadline:
			t.Fatal("timed out waiting for password reset email")
		}
	}
	parsed, err := url.Parse(resetURL)
	if err != nil {
		t.Fatal(err)
	}
	token := parsed.Fragment
	token = strings.TrimPrefix(token, "token=")
	if token == "" {
		t.Fatalf("reset URL = %q", resetURL)
	}

	if got := doIntegrationStatus(t, http.MethodPost, server.URL+"/api/v1/auth/password-reset/confirm", `{"token":"`+token+`","password":"new-password-123"}`, nil, ""); got != http.StatusOK {
		t.Fatalf("confirm status = %d", got)
	}
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/me", "", cookies, ""); got != http.StatusOK {
		t.Fatalf("me status = %d", got)
	}
	meBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/me", "", cookies, "")
	if !strings.Contains(meBody, `"authenticated":false`) {
		t.Fatalf("old session remained active: %s", meBody)
	}
	if got := doIntegrationStatus(t, http.MethodPost, server.URL+"/api/v1/auth/login", `{"email":"`+email+`","password":"password123"}`, nil, ""); got != http.StatusUnauthorized {
		t.Fatalf("old password login status = %d", got)
	}
	if got := doIntegrationStatus(t, http.MethodPost, server.URL+"/api/v1/auth/login", `{"email":"`+email+`","password":"new-password-123"}`, nil, ""); got != http.StatusOK {
		t.Fatalf("new password login status = %d", got)
	}
	if got := doIntegrationStatus(t, http.MethodPost, server.URL+"/api/v1/auth/password-reset/confirm", `{"token":"`+token+`","password":"another-password-123"}`, nil, ""); got != http.StatusBadRequest {
		t.Fatalf("reused token status = %d", got)
	}
}

func TestPasswordResetRetryOrderingWithPostgres(t *testing.T) {
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

	email := fmt.Sprintf("password-reset-ordering-%d@example.com", time.Now().UnixNano())
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'old-password-hash')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)

	store := auth.NewPGStore(db)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tokenAExpiresAt := now.Add(time.Hour)
	tokenAHash := integrationTokenHash(email + "-request-a")
	tokenBHash := integrationTokenHash(email + "-request-b")

	// Request A creates its deterministic token before delivery fails.
	if err := store.CreatePasswordResetToken(ctx, email, tokenAHash, tokenAExpiresAt); err != nil {
		t.Fatal(err)
	}
	// Request B is then created and delivered successfully.
	if err := store.CreatePasswordResetToken(ctx, email, tokenBHash, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// Retrying A must reuse its still-valid token without invalidating B.
	if err := store.CreatePasswordResetToken(ctx, email, tokenAHash, now.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var storedTokenAExpiry time.Time
	if err := db.QueryRow(ctx, `SELECT expires_at FROM password_reset_tokens WHERE token_hash = $1`, tokenAHash).Scan(&storedTokenAExpiry); err != nil {
		t.Fatal(err)
	}
	if !storedTokenAExpiry.Equal(tokenAExpiresAt) {
		t.Fatalf("request A retry changed expiry from %s to %s", tokenAExpiresAt, storedTokenAExpiry)
	}

	for name, tokenHash := range map[string]string{"request A": tokenAHash, "request B": tokenBHash} {
		valid, err := store.PasswordResetTokenValid(ctx, tokenHash, now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if !valid {
			t.Fatalf("%s token is invalid after request A retry", name)
		}
	}

	if err := store.ResetPassword(ctx, tokenBHash, "new-password-hash", now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	for name, tokenHash := range map[string]string{"request A": tokenAHash, "request B": tokenBHash} {
		valid, err := store.PasswordResetTokenValid(ctx, tokenHash, now.Add(3*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if valid {
			t.Fatalf("%s token remained valid after request B reset", name)
		}
	}
	if err := store.CreatePasswordResetToken(ctx, email, tokenAHash, now.Add(time.Hour)); !errors.Is(err, auth.ErrInvalidResetToken) {
		t.Fatalf("used request A token retry error = %v", err)
	}

	if _, err := db.Exec(ctx, `
		UPDATE password_reset_tokens
		SET expires_at = $2
		WHERE token_hash = $1
	`, tokenAHash, now.Add(-25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.CreatePasswordResetToken(ctx, email, tokenAHash, now.Add(time.Hour)); !errors.Is(err, auth.ErrInvalidResetToken) {
		t.Fatalf("old used request A token retry error = %v", err)
	}
	var matchingTokens int
	var used bool
	if err := db.QueryRow(ctx, `
		SELECT count(*), bool_and(used_at IS NOT NULL)
		FROM password_reset_tokens
		WHERE token_hash = $1
	`, tokenAHash).Scan(&matchingTokens, &used); err != nil {
		t.Fatal(err)
	}
	if matchingTokens != 1 || !used {
		t.Fatalf("old token tombstone count = %d, used = %v", matchingTokens, used)
	}
}

func integrationTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

type integrationResetEmail struct {
	email    string
	resetURL string
}

type integrationResetSender struct {
	sent chan integrationResetEmail
}

func (s *integrationResetSender) SendPasswordReset(_ context.Context, email string, resetURL string, _ string) error {
	s.sent <- integrationResetEmail{email: email, resetURL: resetURL}
	return nil
}

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
	stamp := time.Now().UnixNano()
	userOneEmail := fmt.Sprintf("token-one-%d@example.com", stamp)
	userTwoEmail := fmt.Sprintf("token-two-%d@example.com", stamp)
	defer db.Exec(context.Background(), `DELETE FROM users WHERE email = ANY($1)`, []string{userOneEmail, userTwoEmail})

	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}}, db, Options{Billing: config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{userOneEmail, userTwoEmail},
	}})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	userOneCookies := createIntegrationUserAndLogin(t, db, server.URL, userOneEmail)
	userTwoCookies := createIntegrationUserAndLogin(t, db, server.URL, userTwoEmail)

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
	collectionBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/collections", `{"title":"Bearer collection"}`, nil, tokenResponse.Token)
	var bearerCollection struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal([]byte(collectionBody), &bearerCollection); err != nil {
		t.Fatal(err)
	}
	if bearerCollection.Slug != "bearer-collection" {
		t.Fatalf("bearer collection = %s", collectionBody)
	}
	doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/collections", "", nil, tokenResponse.Token)

	docBody := doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Bearer integration"}`, nil, tokenResponse.Token)
	var docResponse struct {
		ID       string `json:"id"`
		PublicID string `json:"publicId"`
	}
	if err := json.Unmarshal([]byte(docBody), &docResponse); err != nil {
		t.Fatal(err)
	}
	if docResponse.ID == "" {
		t.Fatalf("document create body = %s", docBody)
	}
	doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs", "", nil, tokenResponse.Token)
	doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/"+docResponse.ID, "", nil, tokenResponse.Token)
	doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+docResponse.ID, `{"collectionId":"`+bearerCollection.ID+`","starred":true}`, nil, tokenResponse.Token)
	doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+docResponse.ID, `{"body":"# Updated bearer integration"}`, nil, tokenResponse.Token)
	doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs/"+docResponse.ID+"/share", "", nil, tokenResponse.Token)
	publicHTML := doIntegrationRequest(t, http.MethodGet, server.URL+"/d/"+docResponse.PublicID, "", nil, "")
	if !strings.Contains(publicHTML, "Updated bearer integration") || strings.Contains(publicHTML, "bearer-collection") || strings.Contains(publicHTML, "starred") {
		t.Fatalf("public HTML changed or leaked private metadata: %s", publicHTML)
	}
	if raw := doIntegrationRequest(t, http.MethodGet, server.URL+"/d/"+docResponse.PublicID+".md", "", nil, ""); raw != "# Updated bearer integration" {
		t.Fatalf("raw Markdown = %q", raw)
	}

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

	if _, err := db.Exec(ctx, `UPDATE api_tokens SET last_used_at = NULL WHERE id = $1`, tokenResponse.APIToken.ID); err != nil {
		t.Fatal(err)
	}
	fencedApp := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{
		WritesDisabled: true,
		Billing: config.BillingConfig{
			FreeMaxSavedDocs: 5,
			ProMaxSavedDocs:  1000,
			OwnerEmails:      []string{userOneEmail},
		},
	})
	fencedServer := httptest.NewServer(fencedApp.Routes())
	defer fencedServer.Close()
	doIntegrationRequest(t, http.MethodGet, fencedServer.URL+"/api/v1/docs", "", nil, tokenResponse.Token)
	var tokenUsageWasWritten bool
	if err := db.QueryRow(ctx, `SELECT last_used_at IS NOT NULL FROM api_tokens WHERE id = $1`, tokenResponse.APIToken.ID).Scan(&tokenUsageWasWritten); err != nil {
		t.Fatal(err)
	}
	if tokenUsageWasWritten {
		t.Fatal("write-fenced bearer read updated api_tokens.last_used_at")
	}

	doIntegrationRequest(t, http.MethodDelete, server.URL+"/api/v1/api-tokens/"+tokenResponse.APIToken.ID, "", userOneCookies, "")
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/docs", "", nil, tokenResponse.Token); got != http.StatusUnauthorized {
		t.Fatalf("revoked token status = %d, want %d", got, http.StatusUnauthorized)
	}
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/docs", "", nil, ""); got != http.StatusUnauthorized {
		t.Fatalf("anonymous docs status = %d, want %d", got, http.StatusUnauthorized)
	}
}

func TestCollectionAndDocumentMetadataRoutesWithPostgres(t *testing.T) {
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

	stamp := time.Now().UnixNano()
	ownerOne := fmt.Sprintf("collections-one-%d@example.com", stamp)
	ownerTwo := fmt.Sprintf("collections-two-%d@example.com", stamp)
	defer db.Exec(context.Background(), `DELETE FROM users WHERE email = ANY($1)`, []string{ownerOne, ownerTwo})

	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{Billing: config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
	}})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	ownerOneCookies := createIntegrationUserAndLogin(t, db, server.URL, ownerOne)
	ownerTwoCookies := createIntegrationUserAndLogin(t, db, server.URL, ownerTwo)

	var initialCollections struct {
		Collections []struct {
			Slug string `json:"slug"`
		} `json:"collections"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/collections", "", ownerOneCookies, "")), &initialCollections); err != nil {
		t.Fatal(err)
	}
	if len(initialCollections.Collections) != 0 {
		t.Fatalf("initial stored collection count = %d, want 0", len(initialCollections.Collections))
	}

	type collectionResponse struct {
		ID          string  `json:"id"`
		Slug        string  `json:"slug"`
		Title       string  `json:"title"`
		Description *string `json:"description"`
	}
	var ownedCollection collectionResponse
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/collections", `{"title":"Customer Research","description":"Initial"}`, ownerOneCookies, "")), &ownedCollection); err != nil {
		t.Fatal(err)
	}
	if ownedCollection.ID == "" || ownedCollection.Slug != "customer-research" {
		t.Fatalf("created collection = %#v", ownedCollection)
	}
	var renamedCollection collectionResponse
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/collections/"+ownedCollection.Slug, `{"title":"Product Research","description":null}`, ownerOneCookies, "")), &renamedCollection); err != nil {
		t.Fatal(err)
	}
	if renamedCollection.Slug != ownedCollection.Slug || renamedCollection.Title != "Product Research" || renamedCollection.Description != nil {
		t.Fatalf("renamed collection = %#v", renamedCollection)
	}

	var otherCollection collectionResponse
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/collections", `{"title":"Other owner"}`, ownerTwoCookies, "")), &otherCollection); err != nil {
		t.Fatal(err)
	}

	type documentResponse struct {
		ID             string  `json:"id"`
		Body           string  `json:"body"`
		CollectionID   *string `json:"collectionId"`
		CollectionSlug *string `json:"collectionSlug"`
		Starred        bool    `json:"starred"`
	}
	var document documentResponse
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Persistent body"}`, ownerOneCookies, "")), &document); err != nil {
		t.Fatal(err)
	}
	if document.CollectionID != nil || document.CollectionSlug != nil || document.Starred {
		t.Fatalf("new document metadata = %#v", document)
	}

	crossOwnerBody := `{"collectionId":"` + otherCollection.ID + `","starred":true}`
	if got := doIntegrationStatus(t, http.MethodPatch, server.URL+"/api/v1/docs/"+document.ID, crossOwnerBody, ownerOneCookies, ""); got != http.StatusBadRequest {
		t.Fatalf("cross-owner assignment status = %d, want %d", got, http.StatusBadRequest)
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/"+document.ID, "", ownerOneCookies, "")), &document); err != nil {
		t.Fatal(err)
	}
	if document.CollectionID != nil || document.Starred || document.Body != "# Persistent body" {
		t.Fatalf("document changed after rejected assignment = %#v", document)
	}

	metadataBody := `{"collectionId":"` + ownedCollection.ID + `","starred":true}`
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+document.ID, metadataBody, ownerOneCookies, "")), &document); err != nil {
		t.Fatal(err)
	}
	if document.CollectionID == nil || *document.CollectionID != ownedCollection.ID || document.CollectionSlug == nil || *document.CollectionSlug != ownedCollection.Slug || !document.Starred || document.Body != "# Persistent body" {
		t.Fatalf("metadata update = %#v", document)
	}

	listBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs", "", ownerOneCookies, "")
	if !strings.Contains(listBody, `"collectionSlug":"customer-research"`) || !strings.Contains(listBody, `"starred":true`) {
		t.Fatalf("document list omitted metadata: %s", listBody)
	}

	doIntegrationRequest(t, http.MethodDelete, server.URL+"/api/v1/collections/"+ownedCollection.Slug, "", ownerOneCookies, "")
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/"+document.ID, "", ownerOneCookies, "")), &document); err != nil {
		t.Fatal(err)
	}
	if document.CollectionID != nil || document.CollectionSlug != nil || !document.Starred || document.Body != "# Persistent body" {
		t.Fatalf("document after collection deletion = %#v", document)
	}
}

func TestDocumentSearchAPIWithPostgres(t *testing.T) {
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

	stamp := time.Now().UnixNano()
	ownerEmail := fmt.Sprintf("search-api-%d@example.com", stamp)
	otherEmail := fmt.Sprintf("search-api-other-%d@example.com", stamp)
	defer db.Exec(context.Background(), `DELETE FROM users WHERE email = ANY($1)`, []string{ownerEmail, otherEmail})
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{Billing: config.BillingConfig{
		FreeMaxSavedDocs: 100,
		ProMaxSavedDocs:  100,
	}})
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	ownerCookies := createIntegrationUserAndLogin(t, db, server.URL, ownerEmail)
	createIntegrationUserAndLogin(t, db, server.URL, otherEmail)

	var ownerID, otherID, collectionID, otherCollectionID string
	if err := db.QueryRow(ctx, `SELECT id::text FROM users WHERE email = $1`, ownerEmail).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT id::text FROM users WHERE email = $1`, otherEmail).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title)
		VALUES ($1, 'research', 'Research')
		RETURNING id::text
	`, ownerID).Scan(&collectionID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, slug, title)
		VALUES ($1, 'research', 'Research')
		RETURNING id::text
	`, otherID).Scan(&otherCollectionID); err != nil {
		t.Fatal(err)
	}

	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	type fixture struct {
		id           string
		ownerID      string
		title        string
		body         string
		collectionID *string
		archived     bool
		updated      time.Time
	}
	fixtures := []fixture{
		{ownerID: ownerID, title: "Agent workflow", body: "# Title result\n\nNo body terms.", updated: updatedAt},
		{ownerID: ownerID, title: "Deep result", body: "# Deep result\n\n" + strings.Repeat("padding ", 700) + "agent workflow after four kilobytes", collectionID: &collectionID, updated: updatedAt},
		{ownerID: ownerID, title: "Second research result", body: "# Research\n\nagent workflow", collectionID: &collectionID, updated: updatedAt.Add(-time.Minute)},
		{ownerID: ownerID, title: "Archived result", body: "# Archived\n\nagent workflow", archived: true, updated: updatedAt},
		{ownerID: otherID, title: "Other owner result", body: "# Other\n\nagent workflow", collectionID: &otherCollectionID, updated: updatedAt},
	}
	for index := range fixtures {
		item := &fixtures[index]
		var archivedAt *time.Time
		if item.archived {
			archivedAt = &item.updated
		}
		if err := db.QueryRow(ctx, `
			INSERT INTO documents (owner_user_id, public_id, title, body, collection_id, archived_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id::text
		`, item.ownerID, fmt.Sprintf("api-search-%d-%d", stamp, index), item.title, item.body, item.collectionID, archivedAt, item.updated).Scan(&item.id); err != nil {
			t.Fatal(err)
		}
	}

	type searchPage struct {
		Documents []struct {
			ID             string  `json:"id"`
			Body           *string `json:"body"`
			MatchExcerpt   string  `json:"matchExcerpt"`
			CollectionID   *string `json:"collectionId"`
			CollectionSlug *string `json:"collectionSlug"`
		} `json:"documents"`
		NextCursor string `json:"nextCursor"`
	}
	var first searchPage
	firstBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=agent+workflow&limit=2", "", ownerCookies, "")
	if err := json.Unmarshal([]byte(firstBody), &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Documents) != 2 || first.NextCursor == "" || first.Documents[0].ID != fixtures[0].id {
		t.Fatalf("first search page = %#v", first)
	}
	if first.Documents[0].Body != nil || first.Documents[1].Body != nil {
		t.Fatalf("search response exposed bodies: %s", firstBody)
	}
	if !strings.Contains(strings.ToLower(first.Documents[1].MatchExcerpt), "agent workflow") {
		t.Fatalf("deep match excerpt = %q", first.Documents[1].MatchExcerpt)
	}
	var second searchPage
	secondBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=agent+workflow&limit=2&cursor="+url.QueryEscape(first.NextCursor), "", ownerCookies, "")
	if err := json.Unmarshal([]byte(secondBody), &second); err != nil {
		t.Fatal(err)
	}
	if len(second.Documents) != 1 || second.Documents[0].ID == first.Documents[0].ID || second.Documents[0].ID == first.Documents[1].ID {
		t.Fatalf("second search page = %#v", second)
	}

	var collectionPage searchPage
	collectionBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=agent+workflow&collectionId="+collectionID, "", ownerCookies, "")
	if err := json.Unmarshal([]byte(collectionBody), &collectionPage); err != nil {
		t.Fatal(err)
	}
	if len(collectionPage.Documents) != 2 {
		t.Fatalf("collection search = %s", collectionBody)
	}
	for _, document := range collectionPage.Documents {
		if document.CollectionID == nil || *document.CollectionID != collectionID {
			t.Fatalf("collection result = %#v", document)
		}
	}
	var unfiledPage searchPage
	unfiledBody := doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=agent+workflow&unfiled=true", "", ownerCookies, "")
	if err := json.Unmarshal([]byte(unfiledBody), &unfiledPage); err != nil {
		t.Fatal(err)
	}
	if len(unfiledPage.Documents) != 1 || unfiledPage.Documents[0].ID != fixtures[0].id || unfiledPage.Documents[0].CollectionID != nil {
		t.Fatalf("unfiled search = %s", unfiledBody)
	}

	crossOwnerBody, crossOwnerStatus := doIntegrationRequestRaw(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=agent&collectionId="+otherCollectionID, "", ownerCookies, "")
	missingBody, missingStatus := doIntegrationRequestRaw(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=agent&collectionId=99999999-9999-9999-9999-999999999999", "", ownerCookies, "")
	if crossOwnerStatus != http.StatusBadRequest || missingStatus != http.StatusBadRequest || crossOwnerBody != missingBody {
		t.Fatalf("cross-owner/missing collection responses = %d %q / %d %q", crossOwnerStatus, crossOwnerBody, missingStatus, missingBody)
	}
	if got := doIntegrationStatus(t, http.MethodGet, server.URL+"/api/v1/docs/search?q=%21%21%21", "", ownerCookies, ""); got != http.StatusBadRequest {
		t.Fatalf("empty parsed query status = %d", got)
	}
}

func TestConcurrentDocumentCreatesHonorEffectiveLimits(t *testing.T) {
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

	stamp := time.Now().UnixNano()
	ownerEmail := fmt.Sprintf("quota-owner-%d@example.com", stamp)
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{Billing: config.BillingConfig{
		FreeMaxSavedDocs: 1,
		ProMaxSavedDocs:  2,
		OwnerEmails:      []string{ownerEmail},
	}})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	tests := []struct {
		name     string
		email    string
		wantDocs int
		setup    func(string) error
	}{
		{name: "free", email: fmt.Sprintf("quota-free-%d@example.com", stamp), wantDocs: 1, setup: func(string) error { return nil }},
		{name: "owner", email: ownerEmail, wantDocs: 2, setup: func(string) error { return nil }},
		{name: "manual", email: fmt.Sprintf("quota-manual-%d@example.com", stamp), wantDocs: 3, setup: func(userID string) error {
			_, err := db.Exec(ctx, `INSERT INTO billing_accounts (user_id, manual_plan, max_saved_docs) VALUES ($1, 'pro', 3)`, userID)
			return err
		}},
		{name: "community", email: fmt.Sprintf("quota-community-%d@example.com", stamp), wantDocs: 2, setup: func(userID string) error {
			var referralID string
			if err := db.QueryRow(ctx, `INSERT INTO community_referrals (slug, name, code_hash) VALUES ($1, 'Quota test', $2) RETURNING id::text`, fmt.Sprintf("quota-%d", stamp), fmt.Sprintf("hash-%d", stamp)).Scan(&referralID); err != nil {
				return err
			}
			_, err := db.Exec(ctx, `INSERT INTO community_grants (user_id, referral_id) VALUES ($1, $2)`, userID, referralID)
			return err
		}},
		{name: "stripe", email: fmt.Sprintf("quota-stripe-%d@example.com", stamp), wantDocs: 2, setup: func(userID string) error {
			_, err := db.Exec(ctx, `INSERT INTO billing_accounts (user_id, stripe_subscription_status) VALUES ($1, 'active')`, userID)
			return err
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cookies := createIntegrationUserAndLogin(t, db, server.URL, test.email)
			var userID string
			if err := db.QueryRow(ctx, `SELECT id::text FROM users WHERE email = $1`, test.email).Scan(&userID); err != nil {
				t.Fatal(err)
			}
			defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
			if err := test.setup(userID); err != nil {
				t.Fatal(err)
			}

			statuses := make(chan int, 6)
			errors := make(chan error, 6)
			for i := range 6 {
				go func(i int) {
					req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/docs", strings.NewReader(fmt.Sprintf(`{"body":"# Document %d"}`, i)))
					if err != nil {
						errors <- err
						return
					}
					req.Header.Set("Content-Type", "application/json")
					for _, cookie := range cookies {
						req.AddCookie(cookie)
					}
					res, err := http.DefaultClient.Do(req)
					if err != nil {
						errors <- err
						return
					}
					_ = res.Body.Close()
					statuses <- res.StatusCode
				}(i)
			}

			created := 0
			for range 6 {
				select {
				case err := <-errors:
					t.Fatal(err)
				case status := <-statuses:
					if status == http.StatusCreated {
						created++
					} else if status != http.StatusPaymentRequired {
						t.Fatalf("unexpected create status %d", status)
					}
				}
			}
			if created != test.wantDocs {
				t.Fatalf("created = %d, want %d", created, test.wantDocs)
			}
			var savedDocs int
			if err := db.QueryRow(ctx, `SELECT count(*) FROM documents WHERE owner_user_id = $1 AND archived_at IS NULL`, userID).Scan(&savedDocs); err != nil {
				t.Fatal(err)
			}
			if savedDocs != test.wantDocs {
				t.Fatalf("saved docs = %d, want %d", savedDocs, test.wantDocs)
			}

			var documentID string
			if err := db.QueryRow(ctx, `SELECT id::text FROM documents WHERE owner_user_id = $1 AND archived_at IS NULL LIMIT 1`, userID).Scan(&documentID); err != nil {
				t.Fatal(err)
			}
			if status := doIntegrationStatus(t, http.MethodPatch, server.URL+"/api/v1/docs/"+documentID, `{"body":"# Edited at limit"}`, cookies, ""); status != http.StatusOK {
				t.Fatalf("edit-at-limit status = %d", status)
			}
			if status := doIntegrationStatus(t, http.MethodDelete, server.URL+"/api/v1/docs/"+documentID, "", cookies, ""); status != http.StatusNoContent {
				t.Fatalf("delete-at-limit status = %d", status)
			}
			if status := doIntegrationStatus(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Replacement"}`, cookies, ""); status != http.StatusCreated {
				t.Fatalf("replacement status = %d", status)
			}
		})
	}
}

func TestBillingPGStorePreservesSubscriptionMetadataOnPartialUpdate(t *testing.T) {
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

	email := "billing-partial-" + time.Now().UTC().Format("20060102150405.000000000") + "@example.com"
	var userID string
	err = db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id::text
	`, email, "hash").Scan(&userID)
	if err != nil {
		t.Fatal(err)
	}

	store := billing.NewPGStore(db)
	periodEnd := time.Now().UTC().Add(30 * 24 * time.Hour).Truncate(time.Second)
	cancelAtPeriodEnd := true
	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:        "cus_partial_" + userID,
		SubscriptionID:    "sub_partial_" + userID,
		Status:            "active",
		PriceID:           "price_test",
		CurrentPeriodEnd:  &periodEnd,
		CancelAtPeriodEnd: &cancelAtPeriodEnd,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:     "cus_partial_" + userID,
		SubscriptionID: "sub_partial_" + userID,
		Status:         "past_due",
	}); err != nil {
		t.Fatal(err)
	}

	state, err := store.State(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if state.StripeSubscriptionStatus != "past_due" {
		t.Fatalf("status = %q, want past_due", state.StripeSubscriptionStatus)
	}
	if state.StripePriceID != "price_test" || state.StripeCurrentPeriodEnd == nil || !state.StripeCurrentPeriodEnd.Equal(periodEnd) || !state.StripeCancelAtPeriodEnd {
		t.Fatalf("subscription metadata was not preserved: %#v", state)
	}
}

func TestBillingPGStoreRejectsStaleSubscriptionAndCustomerUpdates(t *testing.T) {
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	defer db.Close()
	defer cancel()
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	email := "billing-order-" + time.Now().UTC().Format("20060102150405.000000000") + "@example.com"
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id::text
	`, email, "hash").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)

	store := billing.NewPGStore(db)
	if _, err := store.FindUserByID(ctx, "not-a-uuid"); !errors.Is(err, billing.ErrUserNotFound) {
		t.Fatalf("malformed user lookup error = %v, want user not found", err)
	}
	customerSuffix := strings.ReplaceAll(userID, "-", "")
	type customerResult struct {
		id  string
		err error
	}
	start := make(chan struct{})
	results := make(chan customerResult, 2)
	for _, candidate := range []string{"cus_order_a" + customerSuffix, "cus_order_b" + customerSuffix} {
		go func() {
			<-start
			id, err := store.SetStripeCustomer(ctx, userID, candidate)
			results <- customerResult{id: id, err: err}
		}()
	}
	close(start)
	first := awaitTestValue(t, ctx, results, "first concurrent customer link")
	second := awaitTestValue(t, ctx, results, "second concurrent customer link")
	if first.err != nil {
		t.Fatal(first.err)
	}
	if second.err != nil {
		t.Fatal(second.err)
	}
	if first.id != second.id {
		t.Fatalf("concurrent customer links returned %q and %q", first.id, second.id)
	}
	customerID := first.id
	subscriptionID := "sub_order_" + strings.ReplaceAll(userID, "-", "")
	subscriptionCreated := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	newer := time.Now().UTC()
	older := newer.Add(-time.Nanosecond)
	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:            customerID,
		SubscriptionID:        subscriptionID,
		SubscriptionCreatedAt: &subscriptionCreated,
		Status:                "active",
		EventCreated:          &newer,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:     customerID,
		SubscriptionID: subscriptionID,
		Status:         "canceled",
		EventCreated:   &older,
	}); err != nil {
		t.Fatal(err)
	}
	oldSubscriptionCreated := subscriptionCreated.Add(-time.Hour)
	latest := newer.Add(time.Nanosecond)
	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:            customerID,
		SubscriptionID:        "sub_old_" + strings.ReplaceAll(userID, "-", ""),
		SubscriptionCreatedAt: &oldSubscriptionCreated,
		Status:                "canceled",
		EventCreated:          &latest,
	}); err != nil {
		t.Fatal(err)
	}
	if storedCustomerID, err := store.SetStripeCustomer(ctx, userID, "cus_different"); err != nil {
		t.Fatal(err)
	} else if storedCustomerID != customerID {
		t.Fatalf("stored customer = %q, want %q", storedCustomerID, customerID)
	}

	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	releaseFirstLoad := testRelease(releaseFirst)
	defer releaseFirstLoad()
	firstDone := make(chan error, 1)
	go func() {
		firstDone <- store.RefreshSubscription(ctx, userID, func(loadCtx context.Context) (billing.SubscriptionUpdate, error) {
			close(firstEntered)
			if acquired := db.Stat().AcquiredConns(); acquired != 0 {
				return billing.SubscriptionUpdate{}, fmt.Errorf("pool has %d acquired connections during Stripe load", acquired)
			}
			select {
			case <-releaseFirst:
			case <-loadCtx.Done():
				return billing.SubscriptionUpdate{}, loadCtx.Err()
			}
			return billing.SubscriptionUpdate{
				CustomerID:            customerID,
				SubscriptionID:        subscriptionID,
				SubscriptionCreatedAt: &subscriptionCreated,
				Status:                "active",
			}, nil
		})
	}()
	awaitTestValue(t, ctx, firstEntered, "first Stripe loader")

	secondDB, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		releaseFirstLoad()
		cancel()
		secondDB.Close()
	}()
	secondEntered := make(chan struct{})
	secondDone := make(chan error, 1)
	secondStore := billing.NewPGStore(secondDB)
	go func() {
		secondDone <- secondStore.RefreshSubscription(ctx, userID, func(context.Context) (billing.SubscriptionUpdate, error) {
			close(secondEntered)
			return billing.SubscriptionUpdate{
				CustomerID:            customerID,
				SubscriptionID:        subscriptionID,
				SubscriptionCreatedAt: &subscriptionCreated,
				Status:                "past_due",
			}, nil
		})
	}()
	secondCtx, cancelSecond := context.WithTimeout(ctx, 2*time.Second)
	awaitTestValue(t, secondCtx, secondEntered, "second Stripe loader while the first is delayed")
	secondErr := awaitTestValue(t, secondCtx, secondDone, "second subscription refresh")
	cancelSecond()
	releaseFirstLoad()
	firstErr := awaitTestValue(t, ctx, firstDone, "first subscription refresh")
	if secondErr != nil {
		t.Fatal(secondErr)
	}
	if firstErr != nil {
		t.Fatal(firstErr)
	}

	state, err := store.State(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if state.StripeCustomerID != customerID ||
		state.StripeSubscriptionID != subscriptionID ||
		state.StripeSubscriptionStatus != "past_due" {
		t.Fatalf("stale or conflicting update changed state: %#v", state)
	}

	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:            customerID,
		SubscriptionID:        subscriptionID,
		SubscriptionCreatedAt: &subscriptionCreated,
		Status:                "active",
	}); err != nil {
		t.Fatal(err)
	}

	validEntered := make(chan struct{})
	releaseValid := make(chan struct{})
	releaseValidLoad := testRelease(releaseValid)
	defer releaseValidLoad()
	validDone := make(chan error, 1)
	go func() {
		validDone <- store.RefreshSubscription(ctx, userID, func(loadCtx context.Context) (billing.SubscriptionUpdate, error) {
			close(validEntered)
			select {
			case <-releaseValid:
			case <-loadCtx.Done():
				return billing.SubscriptionUpdate{}, loadCtx.Err()
			}
			return billing.SubscriptionUpdate{
				CustomerID:            customerID,
				SubscriptionID:        subscriptionID,
				SubscriptionCreatedAt: &subscriptionCreated,
				Status:                "past_due",
			}, nil
		})
	}()
	awaitTestValue(t, ctx, validEntered, "valid delayed Stripe loader")

	rejectedSubscriptionCreated := subscriptionCreated.Add(-time.Hour)
	if err := secondStore.RefreshSubscription(ctx, userID, func(context.Context) (billing.SubscriptionUpdate, error) {
		return billing.SubscriptionUpdate{
			CustomerID:            customerID,
			SubscriptionID:        "sub_rejected_" + strings.ReplaceAll(userID, "-", ""),
			SubscriptionCreatedAt: &rejectedSubscriptionCreated,
			Status:                "canceled",
		}, nil
	}); err != nil {
		t.Fatal(err)
	}

	releaseValidLoad()
	if err := awaitTestValue(t, ctx, validDone, "valid delayed refresh after rejected newer refresh"); err != nil {
		t.Fatal(err)
	}
	state, err = store.State(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if state.StripeSubscriptionID != subscriptionID || state.StripeSubscriptionStatus != "past_due" {
		t.Fatalf("rejected newer refresh suppressed valid delayed snapshot: %#v", state)
	}
	var generation, appliedGeneration int64
	if err := db.QueryRow(ctx, `
		SELECT stripe_refresh_generation, stripe_refresh_applied_generation
		FROM billing_accounts
		WHERE user_id = $1
	`, userID).Scan(&generation, &appliedGeneration); err != nil {
		t.Fatal(err)
	}
	if generation != 4 || appliedGeneration != 3 {
		t.Fatalf("refresh generations = (%d, %d), want (4, 3)", generation, appliedGeneration)
	}
}

func TestBillingPGStoreRefreshFailureDoesNotHoldPoolConnection(t *testing.T) {
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	setupDB, err := database.Open(ctx, databaseURL)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	defer setupDB.Close()
	defer cancel()
	if _, err := migrations.Apply(ctx, setupDB); err != nil {
		t.Fatal(err)
	}

	email := "billing-refresh-failure-" + time.Now().UTC().Format("20060102150405.000000000") + "@example.com"
	var userID string
	if err := setupDB.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'hash')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer setupDB.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)

	singleConnectionURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	values := singleConnectionURL.Query()
	values.Set("pool_max_conns", "1")
	singleConnectionURL.RawQuery = values.Encode()
	db, err := database.Open(ctx, singleConnectionURL.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := billing.NewPGStore(db)
	loaderEntered := make(chan struct{})
	releaseLoader := make(chan struct{})
	releaseStripeLoad := testRelease(releaseLoader)
	defer releaseStripeLoad()
	refreshDone := make(chan error, 1)
	customerID := "cus_refresh_failure_" + strings.ReplaceAll(userID, "-", "")
	subscriptionID := "sub_refresh_failure_" + strings.ReplaceAll(userID, "-", "")
	go func() {
		refreshDone <- store.RefreshSubscription(ctx, userID, func(loadCtx context.Context) (billing.SubscriptionUpdate, error) {
			close(loaderEntered)
			select {
			case <-releaseLoader:
			case <-loadCtx.Done():
				return billing.SubscriptionUpdate{}, loadCtx.Err()
			}
			return billing.SubscriptionUpdate{
				CustomerID:     customerID,
				SubscriptionID: subscriptionID,
				Status:         "active",
			}, nil
		})
	}()
	awaitTestValue(t, ctx, loaderEntered, "delayed Stripe loader")

	queryCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	var one int
	queryErr := db.QueryRow(queryCtx, `SELECT 1`).Scan(&one)
	if queryErr != nil {
		t.Fatalf("database connection remained held during Stripe load: %v", queryErr)
	}
	if one != 1 {
		t.Fatalf("SELECT 1 = %d", one)
	}

	stripeErr := errors.New("Stripe request timed out")
	if err := store.RefreshSubscription(ctx, userID, func(context.Context) (billing.SubscriptionUpdate, error) {
		return billing.SubscriptionUpdate{}, stripeErr
	}); !errors.Is(err, stripeErr) {
		t.Fatalf("failed refresh error = %v, want %v", err, stripeErr)
	}

	releaseStripeLoad()
	if err := awaitTestValue(t, ctx, refreshDone, "valid in-flight refresh"); err != nil {
		t.Fatal(err)
	}
	state, err := store.State(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if state.StripeCustomerID != customerID ||
		state.StripeSubscriptionID != subscriptionID ||
		state.StripeSubscriptionStatus != "active" {
		t.Fatalf("valid in-flight refresh was suppressed by failed newer refresh: %#v", state)
	}
	var generation, appliedGeneration int64
	if err := db.QueryRow(ctx, `
		SELECT stripe_refresh_generation, stripe_refresh_applied_generation
		FROM billing_accounts
		WHERE user_id = $1
	`, userID).Scan(&generation, &appliedGeneration); err != nil {
		t.Fatal(err)
	}
	if generation != 2 || appliedGeneration != 1 {
		t.Fatalf("refresh generations = (%d, %d), want (2, 1)", generation, appliedGeneration)
	}
}

func TestConcurrentStripeWebhookRefreshesApplyNewestSnapshot(t *testing.T) {
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	defer db.Close()
	defer cancel()
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	email := "billing-webhook-race-" + time.Now().UTC().Format("20060102150405.000000000") + "@example.com"
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'hash')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)

	customerID := "cus_webhook_race_" + strings.ReplaceAll(userID, "-", "")
	subscriptionID := "sub_webhook_race_" + strings.ReplaceAll(userID, "-", "")
	store := billing.NewPGStore(db)
	if _, err := store.SetStripeCustomer(ctx, userID, customerID); err != nil {
		t.Fatal(err)
	}

	firstStripeRequest := make(chan struct{})
	releaseFirstStripeRequest := make(chan struct{})
	releaseStripeRequest := testRelease(releaseFirstStripeRequest)
	var stripeRequests atomic.Int32
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := "past_due"
		if stripeRequests.Add(1) == 1 {
			close(firstStripeRequest)
			select {
			case <-releaseFirstStripeRequest:
			case <-r.Context().Done():
				return
			}
			status = "active"
		}
		_, _ = fmt.Fprintf(w, `{
			"id":%q,
			"customer":%q,
			"status":%q,
			"metadata":{"passage_user_id":%q}
		}`, subscriptionID, customerID, status, userID)
	}))
	defer stripeServer.Close()
	defer releaseStripeRequest()

	app := &App{
		billing: billing.NewService(store, config.BillingConfig{
			FreeMaxSavedDocs: 5,
			ProMaxSavedDocs:  1000,
		}),
		stripe: billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
	}
	refresh := func() error {
		req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/webhook", nil).WithContext(ctx)
		return app.applyCurrentSubscription(req, customerID, subscriptionID)
	}

	firstDone := make(chan error, 1)
	go func() {
		firstDone <- refresh()
	}()
	awaitTestValue(t, ctx, firstStripeRequest, "first Stripe request")

	secondDone := make(chan error, 1)
	go func() {
		secondDone <- refresh()
	}()
	secondCtx, cancelSecond := context.WithTimeout(ctx, 2*time.Second)
	secondErr := awaitTestValue(t, secondCtx, secondDone, "newer webhook refresh")
	cancelSecond()
	releaseStripeRequest()
	firstErr := awaitTestValue(t, ctx, firstDone, "delayed webhook refresh")
	if secondErr != nil {
		t.Fatal(secondErr)
	}
	if firstErr != nil {
		t.Fatal(firstErr)
	}
	state, err := store.State(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if state.StripeSubscriptionStatus != "past_due" {
		t.Fatalf("stale delayed Stripe snapshot overwrote status: %#v", state)
	}
}

func TestBillingPGStoreListsAdminUsersWithUsage(t *testing.T) {
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

	email := "admin-list-" + time.Now().UTC().Format("20060102150405.000000000") + "@example.com"
	var userID string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id::text
	`, email, "hash").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()
	activeBody := "# Active ✅"
	archivedBody := "# Archived"
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body, archived_at)
		VALUES ($1, $2, 'Active', $4, NULL),
		       ($1, $3, 'Archived', $5, now())
	`, userID, "active-"+userID, "archived-"+userID, activeBody, archivedBody); err != nil {
		t.Fatal(err)
	}
	store := billing.NewPGStore(db)
	if err := store.UpdateSubscription(ctx, userID, billing.SubscriptionUpdate{
		CustomerID:     "cus_admin_" + userID,
		SubscriptionID: "sub_admin_" + userID,
		Status:         "active",
		PriceID:        "price_test",
	}); err != nil {
		t.Fatal(err)
	}

	records, err := store.ListAdminUsers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.User.ID != userID {
			continue
		}
		wantBytes := int64(len([]byte(activeBody)) + len([]byte(archivedBody)))
		if record.User.Email != email ||
			record.SavedDocs != 1 ||
			record.StoredMarkdownBytes != wantBytes ||
			record.State.StripeSubscriptionStatus != "active" {
			t.Fatalf("record = %#v", record)
		}
		return
	}
	t.Fatalf("user %s was not listed", email)
}

func createIntegrationUserAndLogin(t *testing.T, db *database.Pool, baseURL string, email string) []*http.Cookie {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(context.Background(), `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		ON CONFLICT (email) DO UPDATE
		SET password_hash = EXCLUDED.password_hash,
		    updated_at = now()
	`, email, string(hash))
	if err != nil {
		t.Fatal(err)
	}

	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/auth/login", strings.NewReader(`{"email":"`+email+`","password":"password123"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", res.StatusCode)
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

func TestDocumentVersionConflictWithPostgres(t *testing.T) {
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

	stamp := time.Now().UnixNano()
	owner := fmt.Sprintf("versions-%d@example.com", stamp)
	defer db.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, owner)

	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, db, Options{Billing: config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
	}})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	cookies := createIntegrationUserAndLogin(t, db, server.URL, owner)

	var created struct {
		ID      string `json:"id"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Shared note"}`, cookies, "")), &created); err != nil {
		t.Fatal(err)
	}
	if created.Version != 1 {
		t.Fatalf("created version = %d, want 1", created.Version)
	}

	// An agent updates the document while a browser holds version 1.
	var agentWrite struct {
		Body    string `json:"body"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+created.ID, `{"body":"# Shared note\n\nagent edit","version":1}`, cookies, "")), &agentWrite); err != nil {
		t.Fatal(err)
	}
	if agentWrite.Version != 2 {
		t.Fatalf("version after agent write = %d, want 2", agentWrite.Version)
	}

	// The stale browser save must be refused, and must be told what it is up
	// against so it can offer a recovery choice.
	conflictBody, status := doIntegrationRequestRaw(t, http.MethodPatch, server.URL+"/api/v1/docs/"+created.ID, `{"body":"# Shared note\n\nstale browser edit","version":1}`, cookies, "")
	if status != http.StatusConflict {
		t.Fatalf("stale save status = %d, want %d", status, http.StatusConflict)
	}
	var conflict struct {
		Error    string `json:"error"`
		Document struct {
			ID      string `json:"id"`
			Body    string `json:"body"`
			Version int    `json:"version"`
		} `json:"document"`
	}
	if err := json.Unmarshal([]byte(conflictBody), &conflict); err != nil {
		t.Fatal(err)
	}
	if conflict.Error == "" {
		t.Fatal("conflict response carried no error message")
	}
	if conflict.Document.ID != created.ID || conflict.Document.Version != 2 {
		t.Fatalf("conflict document = %+v, want id %s at version 2", conflict.Document, created.ID)
	}
	if conflict.Document.Body != agentWrite.Body {
		t.Fatalf("conflict body = %q, want the agent's %q", conflict.Document.Body, agentWrite.Body)
	}

	// The refused write changed nothing.
	var current struct {
		Body    string `json:"body"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodGet, server.URL+"/api/v1/docs/"+created.ID, "", cookies, "")), &current); err != nil {
		t.Fatal(err)
	}
	if current.Body != agentWrite.Body || current.Version != 2 {
		t.Fatalf("document after refused write = %+v, want the agent body at version 2", current)
	}

	// Retrying against the version the server reported succeeds.
	var resolved struct {
		Body    string `json:"body"`
		Version int    `json:"version"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+created.ID, `{"body":"# Shared note\n\nmerged by hand","version":2}`, cookies, "")), &resolved); err != nil {
		t.Fatal(err)
	}
	if resolved.Version != 3 {
		t.Fatalf("version after resolving = %d, want 3", resolved.Version)
	}

	// A document archived between the refused write and the conflict lookup is
	// gone, not conflicted, and must not read as a server fault.
	var archivedDoc struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPost, server.URL+"/api/v1/docs", `{"body":"# Doomed"}`, cookies, "")), &archivedDoc); err != nil {
		t.Fatal(err)
	}
	doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+archivedDoc.ID, `{"body":"# Doomed\n\nmoved on","version":1}`, cookies, "")
	if _, err := db.Exec(ctx, `UPDATE documents SET archived_at = now() WHERE id = $1`, archivedDoc.ID); err != nil {
		t.Fatal(err)
	}
	if got := doIntegrationStatus(t, http.MethodPatch, server.URL+"/api/v1/docs/"+archivedDoc.ID, `{"body":"# Doomed\n\nstale","version":1}`, cookies, ""); got != http.StatusNotFound {
		t.Fatalf("stale write to an archived document = %d, want %d", got, http.StatusNotFound)
	}

	// Existing clients that omit the version keep working.
	var legacy struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal([]byte(doIntegrationRequest(t, http.MethodPatch, server.URL+"/api/v1/docs/"+created.ID, `{"body":"# Shared note\n\nlegacy client"}`, cookies, "")), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.Version != 4 {
		t.Fatalf("version after versionless write = %d, want 4", legacy.Version)
	}
}
