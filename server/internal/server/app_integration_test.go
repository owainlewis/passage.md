package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
	"golang.org/x/crypto/bcrypt"
)

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

	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}}, db, Options{Billing: config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"token-one@example.com", "token-two@example.com"},
	}})
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	userOneCookies := createIntegrationUserAndLogin(t, db, server.URL, "token-one@example.com")
	userTwoCookies := createIntegrationUserAndLogin(t, db, server.URL, "token-two@example.com")

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

func TestBillingPGStoreListsAdminUsersWithActiveDocumentCounts(t *testing.T) {
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
	if _, err := db.Exec(ctx, `
		INSERT INTO documents (owner_user_id, public_id, title, body, archived_at)
		VALUES ($1, $2, 'Active', '', NULL),
		       ($1, $3, 'Archived', '', now())
	`, userID, "active-"+userID, "archived-"+userID); err != nil {
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
		if record.User.Email != email || record.SavedDocs != 1 || record.State.StripeSubscriptionStatus != "active" {
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
