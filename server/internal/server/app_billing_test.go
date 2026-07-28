package server

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/config"
)

func TestBillingCheckoutCreatesMonthlyStripeSession(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	var checkoutForm url.Values
	customerConfigured := false
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, _, ok := r.BasicAuth(); !ok || user != "sk_test_123" {
			t.Fatalf("missing Stripe basic auth")
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		switch r.URL.Path {
		case "/v1/customers":
			if len(r.Form) != 0 {
				t.Fatalf("unlinked customer form = %v, want no personal data", r.Form)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"cus_test"}`))
		case "/v1/customers/cus_test":
			customerConfigured = true
			if got := r.Form.Get("email"); got != "one@example.com" {
				t.Fatalf("configured customer email = %q", got)
			}
			if got := r.Form.Get("metadata[passage_user_id]"); got != "user-1" {
				t.Fatalf("configured Passage user ID = %q", got)
			}
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
			StripeBillingEnabled: true,
			FreeMaxSavedDocs:     5,
			ProMaxSavedDocs:      1000,
			OwnerEmails:          []string{"owain@owainlewis.com"},
			StripeSecretKey:      "sk_test_123",
			StripeMonthlyPrice:   "price_test",
			StripeWebhookSecret:  "whsec_test",
			AppBaseURL:           "https://passage.test",
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
	if !customerConfigured {
		t.Fatal("canonical Stripe customer was not configured")
	}
	if got := checkoutForm.Get("line_items[0][price]"); got != "price_test" {
		t.Fatalf("checkout price = %q", got)
	}
	if got := checkoutForm.Get("success_url"); got != "https://passage.test/account?billing=success" {
		t.Fatalf("success_url = %q", got)
	}
}

func TestBillingCheckoutPreservesIdempotentCustomerWhenPersistenceFails(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerErr = errors.New("account was deleted")
	customerDeleted := false
	checkoutCreated := false
	customerCreateRequests := 0
	checkoutCustomer := ""
	customerConfigured := false
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
			customerCreateRequests++
			_, _ = w.Write([]byte(`{"id":"cus_candidate"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers/cus_candidate":
			customerConfigured = true
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			if got := r.Form.Get("email"); got != "one@example.com" {
				t.Errorf("configured customer email = %q", got)
			}
			_, _ = w.Write([]byte(`{"id":"cus_candidate"}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/customers/cus_candidate":
			customerDeleted = true
			_, _ = w.Write([]byte(`{"id":"cus_candidate","deleted":true}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
			checkoutCreated = true
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			checkoutCustomer = r.Form.Get("customer")
			_, _ = w.Write([]byte(`{"id":"cs_test","url":"https://checkout.stripe.test/session"}`))
		default:
			t.Errorf("unexpected Stripe request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if customerDeleted {
		t.Fatal("idempotent Stripe customer was deleted after persistence failed")
	}
	if checkoutCreated {
		t.Fatal("Checkout session was created after customer persistence failed")
	}
	if customerConfigured {
		t.Fatal("unlinked Stripe customer received personal data")
	}

	billingStore.setStripeCustomerErr = nil
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("retry status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if customerCreateRequests != 2 {
		t.Fatalf("customer create requests = %d, want 2 idempotent attempts", customerCreateRequests)
	}
	if !checkoutCreated {
		t.Fatal("Checkout session was not created after the persistence retry")
	}
	if !customerConfigured {
		t.Fatal("linked Stripe customer was not configured on retry")
	}
	if checkoutCustomer != "cus_candidate" {
		t.Fatalf("Checkout customer = %q, want cus_candidate", checkoutCustomer)
	}
	if got := billingStore.states["user-1"].StripeCustomerID; got != "cus_candidate" {
		t.Fatalf("stored customer = %q, want cus_candidate", got)
	}
}

func TestBillingCheckoutPersistenceFailureLeavesNoAccountDataWhenUserDoesNotRetry(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerErr = errors.New("database write failed")
	var createForm url.Values
	customerConfigured := false
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			createForm = r.Form
			_, _ = w.Write([]byte(`{"id":"cus_unlinked"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers/cus_unlinked":
			customerConfigured = true
			_, _ = w.Write([]byte(`{"id":"cus_unlinked"}`))
		default:
			t.Errorf("unexpected Stripe request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	delete(billingStore.users, "one@example.com")
	if len(createForm) != 0 {
		t.Fatalf("unlinked Stripe customer retained account data after local deletion: %v", createForm)
	}
	if customerConfigured {
		t.Fatal("unlinked Stripe customer received account data before local persistence")
	}
}

func TestBillingCheckoutDeletesCustomerWhenUserDisappearsDuringPersistenceFailure(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerErr = errors.New("account was deleted")
	requestContext, cancelRequest := context.WithCancel(context.Background())
	billingStore.setStripeCustomerHook = func() {
		delete(billingStore.users, "one@example.com")
		cancelRequest()
	}
	customerDeleted := false
	checkoutCreated := false
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
			_, _ = w.Write([]byte(`{"id":"cus_candidate"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/checkout/sessions":
			_, _ = w.Write([]byte(`{"data":[],"has_more":false}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/customers/cus_candidate":
			customerDeleted = true
			_, _ = w.Write([]byte(`{"id":"cus_candidate","deleted":true}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
			checkoutCreated = true
			_, _ = w.Write([]byte(`{"id":"cs_test","url":"https://checkout.stripe.test/session"}`))
		default:
			t.Errorf("unexpected Stripe request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req = req.WithContext(requestContext)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !customerDeleted {
		t.Fatal("unlinked Stripe customer was not deleted after the user disappeared")
	}
	if checkoutCreated {
		t.Fatal("Checkout session was created after the account disappeared")
	}
}

func TestBillingCheckoutPreservesCandidateAfterAmbiguousPersistenceError(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerErr = errors.New("connection lost after commit")
	billingStore.persistStripeCustomerBeforeError = true
	customerDeleted := false
	checkoutCreated := false
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
			_, _ = w.Write([]byte(`{"id":"cus_candidate"}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/customers/cus_candidate":
			customerDeleted = true
			_, _ = w.Write([]byte(`{"id":"cus_candidate","deleted":true}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
			checkoutCreated = true
			_, _ = w.Write([]byte(`{"id":"cs_test","url":"https://checkout.stripe.test/session"}`))
		default:
			t.Errorf("unexpected Stripe request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if customerDeleted {
		t.Fatal("candidate customer was deleted after an ambiguous committed write")
	}
	if checkoutCreated {
		t.Fatal("Checkout session was created after an ambiguous persistence error")
	}
	if got := billingStore.states["user-1"].StripeCustomerID; got != "cus_candidate" {
		t.Fatalf("stored customer = %q, want cus_candidate", got)
	}
}

func TestBillingCheckoutDeletesSupersededCustomerAndUsesCanonicalCustomer(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerResult = "cus_canonical"
	customerDeleted := false
	checkoutCustomer := ""
	canonicalConfigured := false
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
			_, _ = w.Write([]byte(`{"id":"cus_candidate"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/checkout/sessions":
			_, _ = w.Write([]byte(`{"data":[],"has_more":false}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/customers/cus_candidate":
			customerDeleted = true
			_, _ = w.Write([]byte(`{"id":"cus_candidate","deleted":true}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/customers/cus_canonical":
			canonicalConfigured = true
			_, _ = w.Write([]byte(`{"id":"cus_canonical"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			checkoutCustomer = r.Form.Get("customer")
			_, _ = w.Write([]byte(`{"id":"cs_test","url":"https://checkout.stripe.test/session"}`))
		default:
			t.Errorf("unexpected Stripe request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !customerDeleted {
		t.Fatal("superseded Stripe customer was not deleted")
	}
	if checkoutCustomer != "cus_canonical" {
		t.Fatalf("Checkout customer = %q, want cus_canonical", checkoutCustomer)
	}
	if !canonicalConfigured {
		t.Fatal("canonical Stripe customer was not configured")
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
			StripeBillingEnabled: true,
			StripeSecretKey:      "sk_test_123",
			StripeMonthlyPrice:   "price_test",
			StripeWebhookSecret:  "whsec_test",
			AppBaseURL:           "https://passage.test",
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
		billingConfig: routeStripeBillingConfig(),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/checkout", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestStripeBillingEndpointsReturnUnavailableWhenDisabled(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	app := &App{
		static:  fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:    auth.NewService(authStore, "test-secret", false),
		billing: billing.NewService(newRouteBillingStore(), routeBillingConfig()),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/billing/checkout", nil)
	req.Header.Set("Origin", "http://passage.test")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("session-one")})
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Stripe billing is disabled") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestStripeWebhookUpdatesSubscriptionEntitlement(t *testing.T) {
	authStore := newRouteAuthStore()
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test"}
	now := time.Now().UTC()
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":` + strconv.FormatInt(now.Add(time.Hour).Unix(), 10) + `,
			"items":{"data":[{"price":{"id":"price_1TpAeQRiiEo9jrWNlLdI9HwB"}}]}
		}`))
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(authStore, "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
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

func TestStripeWebhookFailureLogsEventContextWithoutPayload(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test"}
	billingStore.updateSubscriptionErr = errors.New("database unavailable")
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		billingConfig: routeStripeBillingConfig(),
	}
	now := time.Now().UTC()
	body := []byte(`{
		"id":"evt_safe_context",
		"type":"customer.subscription.updated",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"private_marker":"must-not-be-logged",
		"data":{"object":{"id":"sub_test","customer":"cus_test","status":"active"}}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", signedStripePayload(body, "whsec_test", now))
	rec := httptest.NewRecorder()

	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	logged := output.String()
	for _, want := range []string{`"stripe_event_id":"evt_safe_context"`, `"stripe_event_type":"customer.subscription.updated"`, `"operation":"apply Stripe webhook"`} {
		if !strings.Contains(logged, want) {
			t.Fatalf("log %q does not contain %q", logged, want)
		}
	}
	if strings.Contains(logged, "must-not-be-logged") || strings.Contains(logged, string(body)) {
		t.Fatalf("webhook payload was logged: %s", logged)
	}
}

func TestStripeWebhookOrderGrantsPro(t *testing.T) {
	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour).Unix()
	subscriptionBody := []byte(`{
		"id":"evt_subscription_first",
		"type":"customer.subscription.created",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":` + strconv.FormatInt(periodEnd, 10) + `,
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}}
	}`)
	checkoutBody := []byte(`{
		"id":"evt_checkout_second",
		"type":"checkout.session.completed",
		"created":` + strconv.FormatInt(now.Add(time.Second).Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"subscription":"sub_test",
			"client_reference_id":"user-2",
			"payment_status":"paid",
			"metadata":{"passage_user_id":"user-2"}
		}}
	}`)
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/subscriptions/sub_test" {
			t.Fatalf("unexpected Stripe request %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":` + strconv.FormatInt(periodEnd, 10) + `,
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}`))
	}))
	defer stripeServer.Close()

	tests := []struct {
		name   string
		events [][]byte
	}{
		{name: "subscription then Checkout", events: [][]byte{subscriptionBody, checkoutBody}},
		{name: "Checkout then subscription", events: [][]byte{checkoutBody, subscriptionBody}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			billingStore := newRouteBillingStore()
			app := &App{
				static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
				auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
				billing:       billing.NewService(billingStore, routeBillingConfig()),
				stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
				billingConfig: routeStripeBillingConfig(),
			}
			for _, body := range test.events {
				rec := postStripeWebhook(t, app, body, now)
				if rec.Code != http.StatusOK {
					t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
				}
			}
			account, err := app.billing.Account(context.Background(), auth.User{ID: "user-1", Email: "one@example.com"})
			if err != nil {
				t.Fatal(err)
			}
			if account.Plan != billing.PlanPro || account.Source != billing.SourceStripe {
				t.Fatalf("account = %#v", account)
			}
			otherAccount, err := app.billing.Account(context.Background(), auth.User{ID: "user-2", Email: "two@example.com"})
			if err != nil {
				t.Fatal(err)
			}
			if otherAccount.Plan != billing.PlanFree {
				t.Fatalf("client-controlled Checkout identity granted access: %#v", otherAccount)
			}
		})
	}
}

func TestDelayedCheckoutSnapshotRejectsIntermediateSubscriptionEvents(t *testing.T) {
	now := time.Now().UTC()
	checkoutCreated := now.Add(-10 * time.Minute)
	retrievedAt := now.Truncate(time.Second)
	intermediateCreated := retrievedAt
	tests := []struct {
		name               string
		snapshotStatus     string
		refreshedStatus    string
		intermediateType   string
		intermediateStatus string
		wantStatus         string
		wantPlan           billing.Plan
	}{
		{
			name:               "updated event cannot reactivate canceled snapshot",
			snapshotStatus:     "canceled",
			refreshedStatus:    "canceled",
			intermediateType:   "customer.subscription.updated",
			intermediateStatus: "active",
			wantStatus:         "canceled",
			wantPlan:           billing.PlanFree,
		},
		{
			name:               "deleted event cannot cancel reactivated snapshot",
			snapshotStatus:     "active",
			refreshedStatus:    "active",
			intermediateType:   "customer.subscription.deleted",
			intermediateStatus: "canceled",
			wantStatus:         "active",
			wantPlan:           billing.PlanPro,
		},
		{
			name:               "genuinely later deleted state is refreshed",
			snapshotStatus:     "active",
			refreshedStatus:    "canceled",
			intermediateType:   "customer.subscription.deleted",
			intermediateStatus: "canceled",
			wantStatus:         "canceled",
			wantPlan:           billing.PlanFree,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			retrievals := 0
			stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				retrievals++
				status := test.snapshotStatus
				if retrievals > 1 {
					status = test.refreshedStatus
				}
				w.Header().Set("Date", retrievedAt.Format(http.TimeFormat))
				_, _ = w.Write([]byte(`{
					"id":"sub_test",
					"customer":"cus_test",
					"status":` + strconv.Quote(status) + `,
					"metadata":{"passage_user_id":"user-1"},
					"items":{"data":[{"price":{"id":"price_test"}}]}
				}`))
			}))
			defer stripeServer.Close()

			billingStore := newRouteBillingStore()
			app := &App{
				static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
				auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
				billing:       billing.NewService(billingStore, routeBillingConfig()),
				stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
				billingConfig: routeStripeBillingConfig(),
			}
			checkoutBody := []byte(`{
				"id":"evt_delayed_checkout",
				"type":"checkout.session.completed",
				"created":` + strconv.FormatInt(checkoutCreated.Unix(), 10) + `,
				"data":{"object":{
					"customer":"cus_test",
					"subscription":"sub_test",
					"payment_status":"paid"
				}}
			}`)
			rec := postStripeWebhook(t, app, checkoutBody, now)
			if rec.Code != http.StatusOK {
				t.Fatalf("Checkout status = %d, body = %s", rec.Code, rec.Body.String())
			}

			intermediateBody := []byte(`{
				"id":"evt_intermediate",
				"type":` + strconv.Quote(test.intermediateType) + `,
				"created":` + strconv.FormatInt(intermediateCreated.Unix(), 10) + `,
				"data":{"object":{
					"id":"sub_test",
					"customer":"cus_test",
					"status":` + strconv.Quote(test.intermediateStatus) + `,
					"metadata":{"passage_user_id":"user-1"},
					"items":{"data":[{"price":{"id":"price_test"}}]}
				}}
			}`)
			rec = postStripeWebhook(t, app, intermediateBody, now)
			if rec.Code != http.StatusOK {
				t.Fatalf("subscription status = %d, body = %s", rec.Code, rec.Body.String())
			}

			account, err := app.billing.Account(context.Background(), auth.User{ID: "user-1", Email: "one@example.com"})
			if err != nil {
				t.Fatal(err)
			}
			if account.Plan != test.wantPlan || account.Subscription.Status != test.wantStatus {
				t.Fatalf("account = %#v, want plan %q and refreshed status %q", account, test.wantPlan, test.wantStatus)
			}
		})
	}
}

func TestStripeWebhookReplayAndStaleEventsAreIdempotent(t *testing.T) {
	billingStore := newRouteBillingStore()
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}`))
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
	now := time.Now().UTC()
	activeBody := []byte(`{
		"id":"evt_active",
		"type":"customer.subscription.updated",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}}
	}`)
	staleBody := []byte(`{
		"id":"evt_stale",
		"type":"customer.subscription.deleted",
		"created":` + strconv.FormatInt(now.Add(-time.Minute).Unix(), 10) + `,
		"data":{"object":{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"canceled",
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}}
	}`)

	for _, body := range [][]byte{activeBody, activeBody, staleBody} {
		rec := postStripeWebhook(t, app, body, now)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	}
	account, err := app.billing.Account(context.Background(), auth.User{ID: "user-1", Email: "one@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro || account.Subscription.Status != "active" {
		t.Fatalf("account after replay and stale event = %#v", account)
	}
}

func TestStripeWebhookRejectsUnknownAndMalformedIdentifiers(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name             string
		customerID       string
		subscriptionID   string
		metadataUserID   string
		existingCustomer string
	}{
		{name: "malformed customer", customerID: "cus_bad/value", subscriptionID: "sub_test", metadataUserID: "user-1"},
		{name: "malformed subscription", customerID: "cus_test", subscriptionID: "not-a-subscription", metadataUserID: "user-1"},
		{name: "unknown user", customerID: "cus_test", subscriptionID: "sub_test", metadataUserID: "missing-user"},
		{name: "missing metadata", customerID: "cus_test", subscriptionID: "sub_test"},
		{name: "metadata conflicts with customer", customerID: "cus_test", subscriptionID: "sub_test", metadataUserID: "user-2", existingCustomer: "cus_test"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			billingStore := newRouteBillingStore()
			if test.existingCustomer != "" {
				billingStore.states["user-1"] = billing.State{StripeCustomerID: test.existingCustomer}
			}
			stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{
					"id":` + strconv.Quote(test.subscriptionID) + `,
					"customer":` + strconv.Quote(test.customerID) + `,
					"status":"active",
					"metadata":{"passage_user_id":` + strconv.Quote(test.metadataUserID) + `}
				}`))
			}))
			defer stripeServer.Close()
			app := &App{
				static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
				auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
				billing:       billing.NewService(billingStore, routeBillingConfig()),
				stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
				billingConfig: routeStripeBillingConfig(),
			}
			body := []byte(`{
				"id":"evt_invalid",
				"type":"customer.subscription.created",
				"created":` + strconv.FormatInt(now.Unix(), 10) + `,
				"data":{"object":{
					"id":` + strconv.Quote(test.subscriptionID) + `,
					"customer":` + strconv.Quote(test.customerID) + `,
					"status":"active",
					"metadata":{"passage_user_id":` + strconv.Quote(test.metadataUserID) + `}
				}}
			}`)
			rec := postStripeWebhook(t, app, body, now)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			for _, user := range billingStore.users {
				account, err := app.billing.Account(context.Background(), user)
				if err != nil {
					t.Fatal(err)
				}
				if account.Plan != billing.PlanFree {
					t.Fatalf("unsafe entitlement for %s: %#v", user.ID, account)
				}
			}
		})
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
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":` + strconv.FormatInt(periodEnd.Unix(), 10) + `,
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}`))
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
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
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"past_due",
			"current_period_end":` + strconv.FormatInt(periodEnd.Unix(), 10) + `,
			"cancel_at_period_end":true,
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}`))
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
	now := time.Now().UTC()
	body := []byte(`{
		"id":"evt_invoice_failed",
		"type":"invoice.payment_failed",
		"api_version":"2024-06-20",
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

func TestStripeInvoicePaymentFailedSupportsCurrentSchema(t *testing.T) {
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{
		StripeCustomerID:         "cus_test",
		StripeSubscriptionID:     "sub_test",
		StripeSubscriptionStatus: "active",
	}
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/subscriptions/sub_test" {
			t.Fatalf("unexpected Stripe request %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"past_due",
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}`))
	}))
	defer stripeServer.Close()

	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
	now := time.Now().UTC()
	body := []byte(`{
		"id":"evt_current_invoice_failed",
		"type":"invoice.payment_failed",
		"api_version":"2025-03-31.basil",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"parent":{
				"type":"subscription_details",
				"subscription_details":{"subscription":"sub_test"}
			}
		}}
	}`)

	rec := postStripeWebhook(t, app, body, now)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := billingStore.states["user-1"].StripeSubscriptionStatus; got != "past_due" {
		t.Fatalf("status = %q, want past_due", got)
	}
}

func TestStripeInvoicePaymentFailedIgnoresInvalidShapesObservably(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	tests := []struct {
		name   string
		object string
	}{
		{
			name:   "malformed customer",
			object: `"customer":{},"subscription":"sub_test"`,
		},
		{
			name:   "missing subscription",
			object: `"customer":"cus_test"`,
		},
		{
			name:   "malformed legacy subscription",
			object: `"customer":"cus_test","subscription":{}`,
		},
		{
			name:   "malformed parent",
			object: `"customer":"cus_test","parent":[]`,
		},
		{
			name: "unrelated parent",
			object: `"customer":"cus_test","parent":{` +
				`"type":"quote_details",` +
				`"subscription_details":{"subscription":"sub_test"}` +
				`}`,
		},
		{
			name: "missing subscription details",
			object: `"customer":"cus_test","parent":{` +
				`"type":"subscription_details"` +
				`}`,
		},
		{
			name: "malformed current subscription does not fall back to legacy",
			object: `"customer":"cus_test","subscription":"sub_legacy","parent":{` +
				`"type":"subscription_details",` +
				`"subscription_details":{"subscription":{}}` +
				`}`,
		},
		{
			name: "conflicting references",
			object: `"customer":"cus_test","subscription":"sub_legacy","parent":{` +
				`"type":"subscription_details",` +
				`"subscription_details":{"subscription":"sub_current"}` +
				`}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			output.Reset()
			retrievals := 0
			stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				retrievals++
				http.Error(w, "subscription must not be retrieved", http.StatusInternalServerError)
			}))
			defer stripeServer.Close()

			billingStore := newRouteBillingStore()
			billingStore.states["user-1"] = billing.State{
				StripeCustomerID:         "cus_test",
				StripeSubscriptionID:     "sub_test",
				StripeSubscriptionStatus: "active",
			}
			app := &App{
				static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
				auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
				billing:       billing.NewService(billingStore, routeBillingConfig()),
				stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
				billingConfig: routeStripeBillingConfig(),
			}
			now := time.Now().UTC()
			body := []byte(`{
				"id":"evt_ignored_invoice",
				"type":"invoice.payment_failed",
				"api_version":"2025-03-31.basil",
				"created":` + strconv.FormatInt(now.Unix(), 10) + `,
				"data":{"object":{` + test.object + `}}
			}`)

			rec := postStripeWebhook(t, app, body, now)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if retrievals != 0 {
				t.Fatalf("Stripe subscription retrievals = %d, want 0", retrievals)
			}
			if got := billingStore.states["user-1"].StripeSubscriptionStatus; got != "active" {
				t.Fatalf("subscription status changed to %q", got)
			}
			logged := output.String()
			for _, want := range []string{
				`"stripe_event_id":"evt_ignored_invoice"`,
				`"stripe_event_type":"invoice.payment_failed"`,
				`"stripe_api_version":"2025-03-31.basil"`,
				`"operation":"ignore Stripe invoice payment failure"`,
			} {
				if !strings.Contains(logged, want) {
					t.Fatalf("log %q does not contain %q", logged, want)
				}
			}
			if strings.Contains(logged, test.object) || strings.Contains(logged, string(body)) {
				t.Fatalf("webhook payload was logged: %s", logged)
			}
		})
	}
}

func TestStaleInvoicePaymentFailedRefreshesCurrentSubscription(t *testing.T) {
	now := time.Now().UTC()
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"metadata":{"passage_user_id":"user-1"},
			"items":{"data":[{"price":{"id":"price_test"}}]}
		}`))
	}))
	defer stripeServer.Close()
	billingStore := newRouteBillingStore()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
	checkoutBody := []byte(`{
		"id":"evt_checkout",
		"type":"checkout.session.completed",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"subscription":"sub_test",
			"payment_status":"paid"
		}}
	}`)
	invoiceBody := []byte(`{
		"id":"evt_stale_invoice",
		"type":"invoice.payment_failed",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"subscription":"sub_test"
		}}
	}`)
	for _, body := range [][]byte{checkoutBody, invoiceBody} {
		rec := postStripeWebhook(t, app, body, now)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	}
	account, err := app.billing.Account(context.Background(), auth.User{ID: "user-1", Email: "one@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro || account.Subscription.Status != "active" {
		t.Fatalf("account after stale invoice = %#v", account)
	}
}

func TestObsoleteSubscriptionReplayCannotReplaceActiveSubscription(t *testing.T) {
	now := time.Now().UTC()
	newCreated := now.Add(-time.Hour).Unix()
	oldCreated := now.Add(-2 * time.Hour).Unix()
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/subscriptions/sub_new":
			_, _ = w.Write([]byte(`{
				"id":"sub_new",
				"customer":"cus_test",
				"created":` + strconv.FormatInt(newCreated, 10) + `,
				"status":"active",
				"metadata":{"passage_user_id":"user-1"},
				"items":{"data":[{"price":{"id":"price_test"}}]}
			}`))
		case "/v1/subscriptions/sub_old":
			_, _ = w.Write([]byte(`{
				"id":"sub_old",
				"customer":"cus_test",
				"created":` + strconv.FormatInt(oldCreated, 10) + `,
				"status":"canceled",
				"metadata":{"passage_user_id":"user-1"},
				"items":{"data":[{"price":{"id":"price_test"}}]}
			}`))
		default:
			t.Fatalf("unexpected Stripe path %s", r.URL.Path)
		}
	}))
	defer stripeServer.Close()
	billingStore := newRouteBillingStore()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
	checkoutBody := []byte(`{
		"id":"evt_checkout_new",
		"type":"checkout.session.completed",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"customer":"cus_test",
			"subscription":"sub_new",
			"payment_status":"paid"
		}}
	}`)
	oldReplayBody := []byte(`{
		"id":"evt_old_replay",
		"type":"customer.subscription.deleted",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"id":"sub_old",
			"customer":"cus_test"
		}}
	}`)
	for _, body := range [][]byte{checkoutBody, oldReplayBody} {
		rec := postStripeWebhook(t, app, body, now)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	}
	account, err := app.billing.Account(context.Background(), auth.User{ID: "user-1", Email: "one@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro || account.Subscription.StripeSubscriptionID != "sub_new" {
		t.Fatalf("account after obsolete replay = %#v", account)
	}
}

func TestStripeWebhookRetrievesCurrentStripeSubscriptionShape(t *testing.T) {
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test"}
	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour).Unix()
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":null,
			"cancel_at_period_end":false,
			"cancel_at":` + strconv.FormatInt(periodEnd, 10) + `,
			"items":{"data":[{
				"current_period_end":` + strconv.FormatInt(periodEnd, 10) + `,
				"price":{"id":"price_1TpAeQRiiEo9jrWNlLdI9HwB"}
			}]}
		}`))
	}))
	defer stripeServer.Close()
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		stripe:        billing.NewStripeClient("sk_test_123", stripeServer.URL, stripeServer.Client()),
		billingConfig: routeStripeBillingConfig(),
	}
	body := []byte(`{
		"id":"evt_current_shape",
		"type":"customer.subscription.updated",
		"created":` + strconv.FormatInt(now.Unix(), 10) + `,
		"data":{"object":{
			"id":"sub_test",
			"customer":"cus_test",
			"status":"active",
			"current_period_end":null,
			"cancel_at_period_end":false,
			"cancel_at":` + strconv.FormatInt(periodEnd, 10) + `,
			"items":{"data":[{
				"current_period_end":` + strconv.FormatInt(periodEnd, 10) + `,
				"price":{"id":"price_1TpAeQRiiEo9jrWNlLdI9HwB"}
			}]}
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
	if state.StripeCurrentPeriodEnd == nil || state.StripeCurrentPeriodEnd.Unix() != periodEnd {
		t.Fatalf("current period end = %v, want %d", state.StripeCurrentPeriodEnd, periodEnd)
	}
	if !state.StripeCancelAtPeriodEnd {
		t.Fatalf("cancel at period end = false, want true")
	}
}

func TestStripeWebhookRejectsInvalidSignatureWithoutStateChange(t *testing.T) {
	billingStore := newRouteBillingStore()
	billingStore.states["user-1"] = billing.State{StripeCustomerID: "cus_test"}
	app := &App{
		static:        fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:          auth.NewService(newRouteAuthStore(), "test-secret", false),
		billing:       billing.NewService(billingStore, routeBillingConfig()),
		billingConfig: routeStripeBillingConfig(),
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
