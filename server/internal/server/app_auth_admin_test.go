package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/community"
	"github.com/owainlewis/passage.md/server/internal/policy"
	"golang.org/x/crypto/bcrypt"
)

func TestRegisterIsClosedByDefault(t *testing.T) {
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
	if body := rec.Body.String(); body != "{\"error\":\"Public signup is not open\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestPublicRegistrationCreatesFreeAccountWithPolicyAcceptance(t *testing.T) {
	authStore := newRouteAuthStore()
	billingStore := newRouteBillingStore()
	billingStore.users["public@example.com"] = auth.User{ID: "registered-user", Email: "public@example.com"}
	app := &App{
		static:              fstest.MapFS{"index.html": {Data: []byte("ok")}},
		auth:                auth.NewService(authStore, "test-secret", false),
		billing:             billing.NewService(billingStore, routeBillingConfig()),
		publicSignupEnabled: true,
	}

	missingConsent := httptest.NewRecorder()
	missingConsentReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"public@example.com","password":"password123"}`))
	missingConsentReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(missingConsent, missingConsentReq)
	if missingConsent.Code != http.StatusBadRequest || !strings.Contains(missingConsent.Body.String(), "Terms and Privacy acceptance is required") {
		t.Fatalf("missing consent status/body = %d/%s", missingConsent.Code, missingConsent.Body.String())
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"public@example.com","password":"password123","policyVersion":"`+policy.CurrentVersion+`"}`))
	req.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatalf("session cookies = %#v", cookies)
	}
	if authStore.createdPolicyVersion != policy.CurrentVersion || authStore.createdPolicyAcceptedAt.IsZero() {
		t.Fatalf("policy acceptance = %q/%s", authStore.createdPolicyVersion, authStore.createdPolicyAcceptedAt)
	}
	if bcrypt.CompareHashAndPassword([]byte(authStore.createdPasswordHash), []byte("password123")) != nil {
		t.Fatal("registration password was not hashed")
	}

	me := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	meReq.AddCookie(cookies[0])
	app.Routes().ServeHTTP(me, meReq)
	if me.Code != http.StatusOK {
		t.Fatalf("me status/body = %d/%s", me.Code, me.Body.String())
	}
	for _, want := range []string{
		`"authenticated":true`,
		`"publicSignupEnabled":true`,
		`"policyVersion":"` + policy.CurrentVersion + `"`,
		`"plan":"free"`,
		`"source":"default"`,
	} {
		if !strings.Contains(me.Body.String(), want) {
			t.Fatalf("me body = %s, missing %s", me.Body.String(), want)
		}
	}
}

func TestRemovedMagicLinkAPIRoutesReturnNotFound(t *testing.T) {
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("ok")}}, nil)
	for _, path := range []string{"/api/v1/auth/magic-link", "/api/v1/auth/magic-link/verify"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		app.Routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, body = %s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestSmallJSONMutationRoutesRejectOversizedBodies(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("admin-session")] = auth.User{ID: "admin-1", Email: "owain@owainlewis.com"}
	billingStore := newRouteBillingStore()
	authService := auth.NewService(authStore, "test-secret", false)
	app := &App{
		static:    fstest.MapFS{"index.html": {Data: []byte("ok")}},
		auth:      authService,
		billing:   billing.NewService(billingStore, routeBillingConfig()),
		community: community.NewService(newRouteCommunityStore(authStore, billingStore), authService),
	}
	tests := []struct {
		name   string
		path   string
		cookie bool
	}{
		{name: "login", path: "/api/v1/auth/login"},
		{name: "referral", path: "/api/v1/auth/referral/validate"},
		{name: "admin", path: "/api/v1/admin/users/one@example.com/account", cookie: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(`{"value":"`+strings.Repeat("x", 17*1024)+`"}`))
			if test.name == "admin" {
				req.Method = http.MethodPatch
			}
			req.Header.Set("Content-Type", "application/json")
			if test.cookie {
				req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("admin-session")})
			}
			app.Routes().ServeHTTP(rec, req)
			if rec.Code != http.StatusRequestEntityTooLarge {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestReusableReferralSignupWorksWhilePublicRegistrationStaysClosed(t *testing.T) {
	authStore := newRouteAuthStore()
	billingStore := newRouteBillingStore()
	authService := auth.NewService(authStore, "test-secret", false)
	communityStore := newRouteCommunityStore(authStore, billingStore)
	app := &App{
		static:    fstest.MapFS{"index.html": {Data: []byte("<main>passage</main>")}},
		auth:      authService,
		billing:   billing.NewService(billingStore, routeBillingConfig()),
		community: community.NewService(communityStore, authService),
	}

	closed := httptest.NewRecorder()
	closedReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"public@example.com","password":"password123"}`))
	closedReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(closed, closedReq)
	if closed.Code != http.StatusForbidden {
		t.Fatalf("public registration status = %d", closed.Code)
	}

	validate := httptest.NewRecorder()
	validateReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/referral/validate", strings.NewReader(`{"ref":"aiengineer","code":"pass-valid-code"}`))
	validateReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(validate, validateReq)
	if validate.Code != http.StatusOK || !strings.Contains(validate.Body.String(), `"name":"AI Engineer"`) || !strings.Contains(validate.Body.String(), `"policyVersion":"`+policy.CurrentVersion+`"`) {
		t.Fatalf("validate status/body = %d/%s", validate.Code, validate.Body.String())
	}

	signup := httptest.NewRecorder()
	signupReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/referral-signup", strings.NewReader(`{"ref":"aiengineer","code":"pass-valid-code","email":"community@example.com","password":"password123","policyVersion":"`+policy.CurrentVersion+`"}`))
	signupReq.Header.Set("Content-Type", "application/json")
	app.Routes().ServeHTTP(signup, signupReq)
	if signup.Code != http.StatusCreated {
		t.Fatalf("signup status/body = %d/%s", signup.Code, signup.Body.String())
	}
	cookies := signup.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatalf("session cookies = %#v", cookies)
	}
	if communityStore.receivedSlug != "aiengineer" || communityStore.receivedHash != community.HashCode("pass-valid-code") || strings.Contains(signup.Body.String(), "pass-valid-code") {
		t.Fatalf("slug/hash/body = %q/%q/%s", communityStore.receivedSlug, communityStore.receivedHash, signup.Body.String())
	}
	if communityStore.receivedPolicyVersion != policy.CurrentVersion || communityStore.receivedPolicyAcceptedAt.IsZero() {
		t.Fatalf("policy acceptance = %q/%s", communityStore.receivedPolicyVersion, communityStore.receivedPolicyAcceptedAt)
	}

	me := httptest.NewRecorder()
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	meReq.AddCookie(cookies[0])
	app.Routes().ServeHTTP(me, meReq)
	if me.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", me.Code, me.Body.String())
	}
	for _, want := range []string{`"plan":"pro"`, `"source":"community"`, `"subscription":{"cancelAtPeriodEnd":false}`} {
		if !strings.Contains(me.Body.String(), want) {
			t.Fatalf("me body missing %s: %s", want, me.Body.String())
		}
	}
}

func TestReferralValidationAndSignupReturnSafeInvalidError(t *testing.T) {
	authStore := newRouteAuthStore()
	authService := auth.NewService(authStore, "test-secret", false)
	store := newRouteCommunityStore(authStore, newRouteBillingStore())
	store.findErr = community.ErrReferralNotFound
	app := &App{auth: authService, community: community.NewService(store, authService)}
	plain := "PASS-SECRET-PLAINTEXT"
	for _, tc := range []struct {
		path, body string
		status     int
	}{
		{"/api/v1/auth/referral/validate", `{"ref":"aiengineer","code":"` + plain + `"}`, http.StatusNotFound},
		{"/api/v1/auth/referral-signup", `{"ref":"aiengineer","code":"` + plain + `","email":"community@example.com","password":"password123","policyVersion":"` + policy.CurrentVersion + `"}`, http.StatusBadRequest},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		app.Routes().ServeHTTP(rec, req)
		if rec.Code != tc.status || !strings.Contains(rec.Body.String(), community.InvalidReferralMessage()) || strings.Contains(rec.Body.String(), plain) {
			t.Fatalf("%s status/body = %d/%s", tc.path, rec.Code, rec.Body.String())
		}
	}
}

func TestAdminManagesCommunityReferralsAndGrants(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("admin-session")] = auth.User{ID: "admin-1", Email: "owain@owainlewis.com"}
	authStore.sessions[routeTokenHash("member-session")] = auth.User{ID: "member-1", Email: "member@example.com"}
	authService := auth.NewService(authStore, "test-secret", false)
	store := newRouteCommunityStore(authStore, newRouteBillingStore())
	app := &App{
		auth:      authService,
		billing:   billing.NewService(newRouteBillingStore(), routeBillingConfig()),
		community: community.NewService(store, authService),
	}

	forbidden := httptest.NewRecorder()
	forbiddenReq := httptest.NewRequest(http.MethodPost, "http://passage.test/api/v1/admin/community-referrals", strings.NewReader(`{"slug":"forbidden","name":"Forbidden"}`))
	forbiddenReq.Header.Set("Content-Type", "application/json")
	forbiddenReq.Header.Set("Origin", "http://passage.test")
	forbiddenReq.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("member-session")})
	app.Routes().ServeHTTP(forbidden, forbiddenReq)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("non-admin generate status = %d, body = %s", forbidden.Code, forbidden.Body.String())
	}

	id := "11111111-1111-1111-1111-111111111111"
	requests := []struct {
		path, body string
		status     int
	}{
		{"/api/v1/admin/community-referrals", `{"slug":"aiengineer","name":"AI Engineer"}`, http.StatusCreated},
		{"/api/v1/admin/community-referrals/" + id + "/rotate", `{}`, http.StatusOK},
		{"/api/v1/admin/community-referrals/" + id + "/disable", `{}`, http.StatusNoContent},
		{"/api/v1/admin/community-grants/revoke", `{"email":"member@example.com","reason":"membership ended"}`, http.StatusNoContent},
	}
	for _, tc := range requests {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "http://passage.test"+tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://passage.test")
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("admin-session")})
		app.Routes().ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%s status/body = %d/%s", tc.path, rec.Code, rec.Body.String())
		}
	}
	if store.createdSlug != "aiengineer" || store.rotatedID != id || store.disabledID != id || store.revokedEmail != "member@example.com" || store.reason != "membership ended" {
		t.Fatalf("store = %#v", store)
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

func TestAdminDashboardRequiresOwnerAndReturnsAccountSummary(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("admin-session")] = auth.User{ID: "admin-1", Email: "owain@owainlewis.com"}
	authStore.sessions[routeTokenHash("member-session")] = auth.User{ID: "member-1", Email: "member@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.adminUsers = []billing.AdminUserRecord{
		{
			User:                auth.User{ID: "admin-1", Email: "owain@owainlewis.com"},
			CreatedAt:           time.Date(2026, time.July, 18, 10, 0, 0, 0, time.UTC),
			SavedDocs:           2,
			StoredMarkdownBytes: 200,
		},
		{
			User:                auth.User{ID: "user-2", Email: "two@example.com"},
			CreatedAt:           time.Date(2026, time.July, 17, 10, 0, 0, 0, time.UTC),
			State:               billing.State{StripeSubscriptionStatus: "active"},
			SavedDocs:           4,
			StoredMarkdownBytes: 400,
		},
		{
			User:      auth.User{ID: "user-3", Email: "three@example.com"},
			CreatedAt: time.Date(2026, time.July, 16, 10, 0, 0, 0, time.UTC),
		},
	}
	app := &App{
		auth:    auth.NewService(authStore, "test-secret", false),
		billing: billing.NewService(billingStore, routeBillingConfig()),
	}

	tests := map[string]struct {
		cookie     string
		wantStatus int
	}{
		"signed out": {wantStatus: http.StatusUnauthorized},
		"non-admin":  {cookie: "member-session", wantStatus: http.StatusForbidden},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil)
			if test.cookie != "" {
				req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken(test.cookie)})
			}
			app.Routes().ServeHTTP(rec, req)
			if rec.Code != test.wantStatus {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
		})
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: routeSignedToken("admin-session")})
	app.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	for _, want := range []string{
		`"totals":{"users":3,"free":1,"pro":2}`,
		`"email":"owain@owainlewis.com"`,
		`"source":"owner"`,
		`"email":"two@example.com"`,
		`"subscriptionStatus":"active"`,
		`"savedDocs":4`,
		`"storedMarkdownBytes":400`,
	} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("body missing %s: %s", want, rec.Body.String())
		}
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache control = %q", rec.Header().Get("Cache-Control"))
	}
	body := rec.Body.String()
	if strings.Index(body, `"email":"two@example.com"`) > strings.Index(body, `"email":"owain@owainlewis.com"`) {
		t.Fatalf("dashboard is not largest-first: %s", body)
	}
}
