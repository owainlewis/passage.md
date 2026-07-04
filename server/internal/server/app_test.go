package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

func TestHealth(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"database\":\"not_configured\",\"status\":\"ok\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestMeReturnsAnonymousWithoutDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"authenticated\":false}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestDocsRequireDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestDocumentRoutesAcceptBearerTokensAndEnforceOwnership(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	app := &App{
		static: fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:   auth.NewService(authStore, "test-secret", false),
		docs:   documents.NewHandler(docStore),
	}

	anonymous := httptest.NewRecorder()
	anonymousReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	app.Routes().ServeHTTP(anonymous, anonymousReq)
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, body = %s", anonymous.Code, anonymous.Body.String())
	}

	create := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/docs", strings.NewReader(`{"body":"# Token doc"}`))
	createReq.Header.Set("Authorization", "Bearer psg_owner_one")
	createReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(create, createReq)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", create.Code, create.Body.String())
	}
	if docStore.ownerID != "user-1" {
		t.Fatalf("create owner = %q", docStore.ownerID)
	}

	list := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	listReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(list, listReq)
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", list.Code, list.Body.String())
	}

	get := httptest.NewRecorder()
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs/11111111-1111-1111-1111-111111111111", nil)
	getReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(get, getReq)
	if get.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", get.Code, get.Body.String())
	}

	update := httptest.NewRecorder()
	updateReq := httptest.NewRequest(http.MethodPatch, "/api/v1/docs/11111111-1111-1111-1111-111111111111", strings.NewReader(`{"body":"# Updated token doc"}`))
	updateReq.Header.Set("Authorization", "Bearer psg_owner_one")
	updateReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(update, updateReq)
	if update.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", update.Code, update.Body.String())
	}

	otherUser := httptest.NewRecorder()
	otherUserReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs/11111111-1111-1111-1111-111111111111", nil)
	otherUserReq.Header.Set("Authorization", "Bearer psg_owner_two")
	app.Routes().ServeHTTP(otherUser, otherUserReq)
	if otherUser.Code != http.StatusNotFound {
		t.Fatalf("other user status = %d, body = %s", otherUser.Code, otherUser.Body.String())
	}

	authStore.revoked[routeTokenHash("psg_owner_one")] = true
	revoked := httptest.NewRecorder()
	revokedReq := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	revokedReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(revoked, revokedReq)
	if revoked.Code != http.StatusUnauthorized {
		t.Fatalf("revoked status = %d, body = %s", revoked.Code, revoked.Body.String())
	}
}

func TestStaticHandlerFallsBackToIndexForClientRoutes(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html":       {Data: []byte("<main>passage</main>")},
		"_next/app.js":     {Data: []byte("console.log('ok')")},
		"nested/index.txt": {Data: []byte("nested")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/account", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>passage</main>" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerServesExportedHTMLRoute(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html":     {Data: []byte("<main>home</main>")},
		"login.html":     {Data: []byte("<main>login</main>")},
		"login/data.txt": {Data: []byte("data")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/login", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>login</main>" {
		t.Fatalf("body = %q", body)
	}
}

func TestWriteRedirectsAnonymousToLogin(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>home</main>")},
		"write.html": {Data: []byte("<main>write</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/write", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}
	if location := rec.Header().Get("Location"); location != "/login?next=%2Fwrite" {
		t.Fatalf("location = %q", location)
	}
}

func TestWriteServesExportedRouteForSessionUser(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	app := &App{
		static: fstest.MapFS{
			"index.html": {Data: []byte("<main>home</main>")},
			"write.html": {Data: []byte("<main>write</main>")},
		},
		auth: auth.NewService(authStore, "test-secret", false),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/write", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != "<main>write</main>" {
		t.Fatalf("body = %q", body)
	}

	docRec := httptest.NewRecorder()
	docReq := httptest.NewRequest(http.MethodGet, "/write/abcdefghijklmnopqrstuv", nil)
	docReq.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(docRec, docReq)

	if docRec.Code != http.StatusOK {
		t.Fatalf("document write status = %d, want %d", docRec.Code, http.StatusOK)
	}
	docBody, _ := io.ReadAll(docRec.Result().Body)
	if string(docBody) != "<main>write</main>" {
		t.Fatalf("document write body = %q", docBody)
	}
}

func TestRegisterIsClosedBeta(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"u@example.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != "{\"error\":\"Passage is in closed beta\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestMeIncludesServerAccountForOwnerComp(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "owain@owainlewis.com"}
	billingStore := newRouteBillingStore()
	billingStore.savedDocs["user-1"] = 2
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		billing: billing.NewService(billingStore, routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{`"authenticated":true`, `"plan":"pro"`, `"source":"owner"`, `"maxSavedDocs":1000`, `"savedDocs":2`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %s: %s", want, body)
		}
	}
}

func TestCreateDocReturnsPaymentRequiredAtFreeLimit(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	billingStore := newRouteBillingStore()
	billingStore.savedDocs["user-1"] = 5
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		docs:    documents.NewHandler(docStore),
		billing: billing.NewService(billingStore, routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/docs", strings.NewReader(`{"body":"# Limit"}`))
	req.Header.Set("Authorization", "Bearer psg_owner_one")
	req.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if docStore.body != "" {
		t.Fatalf("document store was called with body %q", docStore.body)
	}
}

func TestPaidOnlyRoutesReturnPaymentRequiredForFreeUsers(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	docStore := newRouteDocumentStore()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		docs:    documents.NewHandler(docStore),
		billing: billing.NewService(newRouteBillingStore(), routeBillingConfig()),
	}

	share := httptest.NewRecorder()
	shareReq := httptest.NewRequest(http.MethodPost, "/api/v1/docs/11111111-1111-1111-1111-111111111111/share", nil)
	shareReq.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(share, shareReq)
	if share.Code != http.StatusPaymentRequired {
		t.Fatalf("share status = %d, body = %s", share.Code, share.Body.String())
	}

	token := httptest.NewRecorder()
	tokenReq := httptest.NewRequest(http.MethodPost, "/api/v1/api-tokens", strings.NewReader(`{"name":"CLI"}`))
	tokenReq.Header.Set("Content-Type", "application/json")
	tokenReq.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(token, tokenReq)
	if token.Code != http.StatusPaymentRequired {
		t.Fatalf("token status = %d, body = %s", token.Code, token.Body.String())
	}
}

func TestBearerDocumentAPIReturnsPaymentRequiredForFreeUsers(t *testing.T) {
	authStore := newRouteAuthStore()
	docStore := newRouteDocumentStore()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		docs:    documents.NewHandler(docStore),
		billing: billing.NewService(newRouteBillingStore(), routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	req.Header.Set("Authorization", "Bearer psg_owner_one")
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminCanUpdateAccountOverride(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("admin-session")] = auth.User{ID: "admin-1", Email: "owain@owainlewis.com"}
	billingStore := newRouteBillingStore()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		billing: billing.NewService(billingStore, routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "http://passage.test/api/v1/admin/users/two@example.com/account", strings.NewReader(`{"plan":"pro","maxSavedDocs":42}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("admin-session")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{`"email":"two@example.com"`, `"plan":"pro"`, `"source":"manual"`, `"maxSavedDocs":42`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %s: %s", want, body)
		}
	}
}

func TestBillingCheckoutCreatesMonthlyStripeSession(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	var checkoutForm url.Values
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, _, ok := r.BasicAuth(); !ok || user != "sk_test_123" {
			t.Fatalf("missing Stripe basic auth")
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		switch r.URL.Path {
		case "/v1/customers":
			if got := r.Form.Get("email"); got != "one@example.com" {
				t.Fatalf("customer email = %q", got)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"cus_test"}`))
		case "/v1/checkout/sessions":
			checkoutForm = r.Form
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"cs_test","url":"https://checkout.stripe.test/session"}`))
		default:
			t.Fatalf("unexpected Stripe path %s", r.URL.Path)
		}
	}))
	defer stripeServer.Close()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		billing: billing.NewService(billingStore, routeBillingConfig()),
		stripe:  billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: config.BillingConfig{
			FreeMaxSavedDocs:   5,
			ProMaxSavedDocs:    1000,
			OwnerEmails:        []string{"owain@owainlewis.com"},
			StripeSecretKey:    "sk_test_123",
			StripeMonthlyPrice: "price_1TpAeQRiiEo9jrWNlLdI9HwB",
			AppBaseURL:         "https://passage.test",
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "https://checkout.stripe.test/session") {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if got := billingStore.states["user-1"].StripeCustomerID; got != "cus_test" {
		t.Fatalf("stored customer = %q", got)
	}
	if got := billingStore.states["user-1"].StripeSubscriptionStatus; got != "" {
		t.Fatalf("checkout wrote subscription status = %q", got)
	}
	if got := checkoutForm.Get("line_items[0][price]"); got != "price_1TpAeQRiiEo9jrWNlLdI9HwB" {
		t.Fatalf("checkout price = %q", got)
	}
	if got := checkoutForm.Get("success_url"); got != "https://passage.test/account?billing=success" {
		t.Fatalf("success_url = %q", got)
	}
}

func TestBillingPortalCreatesStripePortalSession(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test", StripeSubscriptionStatus: "active"}
	var portalForm url.Values
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/billing_portal/sessions" {
			t.Fatalf("unexpected Stripe path %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		portalForm = r.Form
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"bps_test","url":"https://billing.stripe.test/session"}`))
	}))
	defer stripeServer.Close()
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		billing: billing.NewService(billingStore, routeBillingConfig()),
		stripe:  billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: config.BillingConfig{
			StripeSecretKey: "sk_test_123",
			AppBaseURL:      "https://passage.test",
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/portal", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := portalForm.Get("customer"); got != "cus_test" {
		t.Fatalf("portal customer = %q", got)
	}
	if !strings.Contains(rec.Body.String(), "https://billing.stripe.test/session") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestBillingEndpointsRequireSession(t *testing.T) {
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(newRouteBillingStore(), routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", "https://stripe.test", nil),
		billingConfig: config.BillingConfig{StripeSecretKey: "sk_test_123", StripeMonthlyPrice: "price_test"},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/checkout", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestStripeWebhookUpdatesSubscriptionEntitlement(t *testing.T) {
	authStore := newRouteAuthStore()
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test"}
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		billingConfig: config.BillingConfig{StripeWebhookSecret: "whsec_test"},
	}
	now := time.Now().UTC()
	body := []byte(`{
		"id":"evt_test",
		"type":"customer.subscription.updated",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":` + strconv.FormatInt(now.Add(time.Hour).Unix(), 10) + `,
			"items":{"data":[{"price":{"id":"price_1TpAeQRiiEo9jrWNlLdI9HwB"}}]}
		}}
	}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", signedStripePayload(body, "whsec_test", now))
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	account, err := app.billing.Account(context.Background(), auth.User{ID: "user-1", Email: "one@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro || account.Source != billing.SourceStripe {
		t.Fatalf("account = %#v", account)
	}
	if account.Subscription.StripeSubscriptionID != "sub_test" {
		t.Fatalf("subscription = %#v", account.Subscription)
	}
}

func TestStripeCheckoutWebhookDoesNotOverwriteSubscriptionState(t *testing.T) {
	billingStore := newRouteBillingStore()
	periodEnd := time.Now().UTC().Add(30 * 24 * time.Hour).Truncate(time.Second)
	billingStore.states["user-1"] = billing.State{
		StripeCustomerID:         "cus_test",
		StripeSubscriptionID:     "sub_test",
		StripeSubscriptionStatus: "active",
		StripePriceID:            "price_test",
		StripeCurrentPeriodEnd:   &periodEnd,
	}
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		billingConfig: config.BillingConfig{StripeWebhookSecret: "whsec_test"},
	}
	now := time.Now().UTC()
	body := []byte(`{
		"id":"evt_checkout_late",
		"type":"checkout.session.completed",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"subscription":"sub_test",
			"client_reference_id":"user-1",
			"payment_status":"paid"
		}}
	}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", signedStripePayload(body, "whsec_test", now))
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	state := billingStore.states["user-1"]
	if state.StripeSubscriptionStatus != "active" || state.StripePriceID != "price_test" || state.StripeCurrentPeriodEnd == nil {
		t.Fatalf("subscription state was overwritten: %#v", state)
	}
}

func TestStripeInvoicePaymentFailedPreservesSubscriptionMetadata(t *testing.T) {
	billingStore := newRouteBillingStore()
	periodEnd := time.Now().UTC().Add(30 * 24 * time.Hour).Truncate(time.Second)
	billingStore.states["user-1"] = billing.State{
		StripeCustomerID:         "cus_test",
		StripeSubscriptionID:     "sub_test",
		StripeSubscriptionStatus: "active",
		StripePriceID:            "price_test",
		StripeCurrentPeriodEnd:   &periodEnd,
		StripeCancelAtPeriodEnd:  true,
	}
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		billingConfig: config.BillingConfig{StripeWebhookSecret: "whsec_test"},
	}
	now := time.Now().UTC()
	body := []byte(`{
		"id":"evt_invoice_failed",
		"type":"invoice.payment_failed",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"subscription":"sub_test"
		}}
	}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", signedStripePayload(body, "whsec_test", now))
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	state := billingStore.states["user-1"]
	if state.StripeSubscriptionStatus != "past_due" {
		t.Fatalf("status = %q, want past_due", state.StripeSubscriptionStatus)
	}
	if state.StripePriceID != "price_test" || state.StripeCurrentPeriodEnd == nil || !state.StripeCurrentPeriodEnd.Equal(periodEnd) || !state.StripeCancelAtPeriodEnd {
		t.Fatalf("subscription metadata was not preserved: %#v", state)
	}
}

func TestStripeWebhookRejectsInvalidSignatureWithoutStateChange(t *testing.T) {
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test"}
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		billingConfig: config.BillingConfig{StripeWebhookSecret: "whsec_test"},
	}
	body := []byte(`{"id":"evt_bad","type":"customer.subscription.updated","created":1,"data":{"object":{"id":"sub_test","customer":"cus_test","status":"active"}}}`)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", "t=1,v1=bad")
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := billingStore.states["user-1"].StripeSubscriptionStatus; got != "" {
		t.Fatalf("subscription status changed to %q", got)
	}
}

func TestStaticHandlerServesHeadForIndex(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<main>home</main>"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp(os.DirFS(dir), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "/", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "" {
		t.Fatalf("body = %q", body)
	}
}

func TestStaticHandlerReturnsNotFoundForMissingAssets(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>home</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/_next/static/missing.js", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

type routeAuthStore struct {
	users    map[string]auth.User
	sessions map[string]auth.User
	revoked  map[string]bool
}

func newRouteAuthStore() *routeAuthStore {
	return &routeAuthStore{
		users: map[string]auth.User{
			routeTokenHash("psg_owner_one"): {ID: "user-1", Email: "one@example.com"},
			routeTokenHash("psg_owner_two"): {ID: "user-2", Email: "two@example.com"},
		},
		sessions: map[string]auth.User{},
		revoked:  map[string]bool{},
	}
}

func (s *routeAuthStore) CreateUser(ctx context.Context, email string, passwordHash string) (auth.User, error) {
	return auth.User{}, errors.New("not implemented")
}

func (s *routeAuthStore) FindUserByEmail(ctx context.Context, email string) (auth.UserWithPassword, error) {
	return auth.UserWithPassword{}, auth.ErrInvalidAuth
}

func (s *routeAuthStore) FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (auth.User, error) {
	user, ok := s.sessions[tokenHash]
	if !ok {
		return auth.User{}, auth.ErrUnauthorized
	}
	return user, nil
}

func (s *routeAuthStore) CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	return errors.New("not implemented")
}

func (s *routeAuthStore) DeleteSession(ctx context.Context, tokenHash string) error {
	return nil
}

func (s *routeAuthStore) ListAPITokens(ctx context.Context, userID string) ([]auth.APIToken, error) {
	return nil, nil
}

func (s *routeAuthStore) CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (auth.APIToken, error) {
	return auth.APIToken{}, errors.New("not implemented")
}

func (s *routeAuthStore) RevokeAPIToken(ctx context.Context, userID string, id string) error {
	return auth.ErrUnauthorized
}

func (s *routeAuthStore) FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (auth.User, error) {
	if s.revoked[tokenHash] {
		return auth.User{}, auth.ErrUnauthorized
	}
	user, ok := s.users[tokenHash]
	if !ok {
		return auth.User{}, auth.ErrUnauthorized
	}
	return user, nil
}

func routeTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func routeSignedToken(token string) string {
	mac := hmac.New(sha256.New, []byte("test-secret"))
	_, _ = mac.Write([]byte(token))
	return token + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func signedStripePayload(payload []byte, secret string, at time.Time) string {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(payload)
	return "t=" + timestamp + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

type routeDocumentStore struct {
	ownerID string
	body    string
}

func newRouteDocumentStore() *routeDocumentStore {
	return &routeDocumentStore{}
}

func (s *routeDocumentStore) List(ctx context.Context, ownerID string) ([]documents.Document, error) {
	s.ownerID = ownerID
	return []documents.Document{}, nil
}

func (s *routeDocumentStore) Create(ctx context.Context, ownerID string, body string) (documents.Document, error) {
	s.ownerID = ownerID
	s.body = body
	return documents.Document{ID: "11111111-1111-1111-1111-111111111111", PublicID: "abcdefghijklmnopqrstuv", Title: "Token doc", Body: body}, nil
}

func (s *routeDocumentStore) Get(ctx context.Context, ownerID string, id string) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	return documents.Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Title: "Token doc", Body: s.body}, nil
}

func (s *routeDocumentStore) Update(ctx context.Context, ownerID string, id string, body string) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	s.body = body
	return documents.Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Title: "Token doc", Body: body}, nil
}

func (s *routeDocumentStore) Archive(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.ErrNotFound
	}
	return nil
}

func (s *routeDocumentStore) Share(ctx context.Context, ownerID string, id string) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	return documents.Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Title: "Token doc", Body: s.body, ShareToken: &token}, nil
}

func (s *routeDocumentStore) Unshare(ctx context.Context, ownerID string, id string) error {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.ErrNotFound
	}
	return nil
}

func (s *routeDocumentStore) GetPublic(ctx context.Context, token string) (documents.Document, error) {
	return documents.Document{}, documents.ErrNotFound
}

type routeBillingStore struct {
	users     map[string]auth.User
	states    map[string]billing.State
	savedDocs map[string]int
}

func newRouteBillingStore() *routeBillingStore {
	return &routeBillingStore{
		users: map[string]auth.User{
			"one@example.com": {ID: "user-1", Email: "one@example.com"},
			"two@example.com": {ID: "user-2", Email: "two@example.com"},
		},
		states:    map[string]billing.State{},
		savedDocs: map[string]int{},
	}
}

func routeBillingConfig() config.BillingConfig {
	return config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"owain@owainlewis.com"},
	}
}

func (s *routeBillingStore) FindUserByEmail(ctx context.Context, email string) (auth.User, error) {
	user, ok := s.users[email]
	if !ok {
		return auth.User{}, billing.ErrUserNotFound
	}
	return user, nil
}

func (s *routeBillingStore) FindUserByStripeCustomer(ctx context.Context, customerID string) (auth.User, error) {
	for userID, state := range s.states {
		if state.StripeCustomerID == customerID {
			for _, user := range s.users {
				if user.ID == userID {
					return user, nil
				}
			}
		}
	}
	return auth.User{}, billing.ErrUserNotFound
}

func (s *routeBillingStore) State(ctx context.Context, userID string) (billing.State, error) {
	return s.states[userID], nil
}

func (s *routeBillingStore) UpdateOverride(ctx context.Context, userID string, plan *billing.Plan, maxSavedDocs *int) error {
	state := s.states[userID]
	state.ManualPlan = plan
	state.MaxSavedDocs = maxSavedDocs
	s.states[userID] = state
	return nil
}

func (s *routeBillingStore) SetStripeCustomer(ctx context.Context, userID string, customerID string) error {
	state := s.states[userID]
	state.StripeCustomerID = customerID
	s.states[userID] = state
	return nil
}

func (s *routeBillingStore) UpdateSubscription(ctx context.Context, userID string, update billing.SubscriptionUpdate) error {
	state := s.states[userID]
	if update.CustomerID != "" {
		state.StripeCustomerID = update.CustomerID
	}
	state.StripeSubscriptionID = update.SubscriptionID
	state.StripeSubscriptionStatus = update.Status
	if update.PriceID != "" {
		state.StripePriceID = update.PriceID
	}
	if update.CurrentPeriodEnd != nil {
		state.StripeCurrentPeriodEnd = update.CurrentPeriodEnd
	}
	if update.CancelAtPeriodEnd != nil {
		state.StripeCancelAtPeriodEnd = *update.CancelAtPeriodEnd
	}
	s.states[userID] = state
	return nil
}

func (s *routeBillingStore) CountSavedDocs(ctx context.Context, userID string) (int, error) {
	return s.savedDocs[userID], nil
}
