package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
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
	"github.com/owainlewis/passage.md/server/internal/community"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

func TestHealthReturnsUnavailableWithoutDatabase(t *testing.T) {
	app := NewApp(fstest.MapFS{
		"index.html": {Data: []byte("<main>passage</main>")},
	}, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	app.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := rec.Body.String(); body != "{\"database\":\"not_configured\",\"status\":\"unavailable\"}\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestHealthChecksDatabase(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		body   string
	}{
		{name: "available", status: http.StatusOK, body: "{\"database\":\"ok\",\"status\":\"ok\"}\n"},
		{name: "unavailable", err: errors.New("database down"), status: http.StatusServiceUnavailable, body: "{\"database\":\"unavailable\",\"status\":\"unavailable\"}\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pinger := &routeDatabasePinger{err: test.err}
			app := &App{static: fstest.MapFS{"index.html": {Data: []byte("ok")}}, databaseHealth: pinger}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			app.Routes().ServeHTTP(rec, req)
			if rec.Code != test.status || rec.Body.String() != test.body {
				t.Fatalf("status/body = %d/%q", rec.Code, rec.Body.String())
			}
			if pinger.calls != 1 {
				t.Fatalf("ping calls = %d", pinger.calls)
			}
		})
	}
}

type routeDatabasePinger struct {
	err   error
	calls int
}

func (p *routeDatabasePinger) Ping(context.Context) error {
	p.calls++
	return p.err
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
	if validate.Code != http.StatusOK || !strings.Contains(validate.Body.String(), `"name":"AI Engineer"`) {
		t.Fatalf("validate status/body = %d/%s", validate.Code, validate.Body.String())
	}

	signup := httptest.NewRecorder()
	signupReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/referral-signup", strings.NewReader(`{"ref":"aiengineer","code":"pass-valid-code","email":"community@example.com","password":"password123"}`))
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
		{"/api/v1/auth/referral-signup", `{"ref":"aiengineer","code":"` + plain + `","email":"community@example.com","password":"password123"}`, http.StatusBadRequest},
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

func TestAdminDashboardRequiresOwnerAndReturnsAccountSummary(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("admin-session")] = auth.User{ID: "admin-1", Email: "owain@owainlewis.com"}
	authStore.sessions[routeTokenHash("member-session")] = auth.User{ID: "member-1", Email: "member@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.adminUsers = []billing.AdminUserRecord{
		{
			User:      auth.User{ID: "admin-1", Email: "owain@owainlewis.com"},
			CreatedAt: time.Date(2026, time.July, 18, 10, 0, 0, 0, time.UTC),
			SavedDocs: 2,
		},
		{
			User:      auth.User{ID: "user-2", Email: "two@example.com"},
			CreatedAt: time.Date(2026, time.July, 17, 10, 0, 0, 0, time.UTC),
			State:     billing.State{StripeSubscriptionStatus: "active"},
			SavedDocs: 4,
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
	} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("body missing %s: %s", want, rec.Body.String())
		}
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cache control = %q", rec.Header().Get("Cache-Control"))
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
	if got := checkoutForm.Get("line_items[0][price]"); got != "price_test" {
		t.Fatalf("checkout price = %q", got)
	}
	if got := checkoutForm.Get("success_url"); got != "https://passage.test/account?billing=success" {
		t.Fatalf("success_url = %q", got)
	}
}

func TestBillingCheckoutDeletesCustomerWhenPersistenceFails(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerErr = errors.New("account was deleted")
	requestContext, cancelRequest := context.WithCancel(context.Background())
	billingStore.setStripeCustomerHook = cancelRequest
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
		t.Fatal("unlinked Stripe customer was not deleted")
	}
	if checkoutCreated {
		t.Fatal("Checkout session was created after customer persistence failed")
	}
}

func TestBillingCheckoutDeletesSupersededCustomerAndUsesCanonicalCustomer(t *testing.T) {
	authStore := newRouteAuthStore()
	authStore.sessions[routeTokenHash("session-one")] = auth.User{ID: "user-1", Email: "one@example.com"}
	billingStore := newRouteBillingStore()
	billingStore.setStripeCustomerResult = "cus_canonical"
	customerDeleted := false
	checkoutCustomer := ""
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

func postStripeWebhook(t *testing.T, app *App, body []byte, signedAt time.Time) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", signedStripePayload(body, "whsec_test", signedAt))
	app.Routes().ServeHTTP(rec, req)
	return rec
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

func (s *routeDocumentStore) Create(ctx context.Context, ownerID string, body string, maxSavedDocs int) (documents.Document, error) {
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
	users                   map[string]auth.User
	states                  map[string]billing.State
	eventCreated            map[string]time.Time
	subscriptionCreated     map[string]time.Time
	savedDocs               map[string]int
	adminUsers              []billing.AdminUserRecord
	updateSubscriptionErr   error
	setStripeCustomerErr    error
	setStripeCustomerResult string
	setStripeCustomerHook   func()
}

func newRouteBillingStore() *routeBillingStore {
	return &routeBillingStore{
		users: map[string]auth.User{
			"one@example.com": {ID: "user-1", Email: "one@example.com"},
			"two@example.com": {ID: "user-2", Email: "two@example.com"},
		},
		states:              map[string]billing.State{},
		eventCreated:        map[string]time.Time{},
		subscriptionCreated: map[string]time.Time{},
		savedDocs:           map[string]int{},
	}
}

func routeBillingConfig() config.BillingConfig {
	return config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"owain@owainlewis.com"},
	}
}

func routeStripeBillingConfig() config.BillingConfig {
	cfg := routeBillingConfig()
	cfg.StripeBillingEnabled = true
	cfg.StripeSecretKey = "sk_test_123"
	cfg.StripeMonthlyPrice = "price_test"
	cfg.StripeWebhookSecret = "whsec_test"
	cfg.AppBaseURL = "https://passage.test"
	return cfg
}

func (s *routeBillingStore) FindUserByEmail(ctx context.Context, email string) (auth.User, error) {
	user, ok := s.users[email]
	if !ok {
		return auth.User{}, billing.ErrUserNotFound
	}
	return user, nil
}

func (s *routeBillingStore) FindUserByID(ctx context.Context, userID string) (auth.User, error) {
	for _, user := range s.users {
		if user.ID == userID {
			return user, nil
		}
	}
	return auth.User{}, billing.ErrUserNotFound
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

func (s *routeBillingStore) ListAdminUsers(ctx context.Context) ([]billing.AdminUserRecord, error) {
	return s.adminUsers, nil
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

func (s *routeBillingStore) SetStripeCustomer(ctx context.Context, userID string, customerID string) (string, error) {
	if s.setStripeCustomerHook != nil {
		s.setStripeCustomerHook()
	}
	if s.setStripeCustomerErr != nil {
		return "", s.setStripeCustomerErr
	}
	state := s.states[userID]
	if s.setStripeCustomerResult != "" {
		state.StripeCustomerID = s.setStripeCustomerResult
		s.states[userID] = state
		return s.setStripeCustomerResult, nil
	}
	if state.StripeCustomerID != "" {
		return state.StripeCustomerID, nil
	}
	state.StripeCustomerID = customerID
	s.states[userID] = state
	return customerID, nil
}

func (s *routeBillingStore) UpdateSubscription(ctx context.Context, userID string, update billing.SubscriptionUpdate) error {
	if s.updateSubscriptionErr != nil {
		return s.updateSubscriptionErr
	}
	state := s.states[userID]
	if state.StripeCustomerID != "" && update.CustomerID != "" && state.StripeCustomerID != update.CustomerID {
		return nil
	}
	if state.StripeSubscriptionID != "" && state.StripeSubscriptionID != update.SubscriptionID {
		currentPaid := state.StripeSubscriptionStatus == "active" || state.StripeSubscriptionStatus == "trialing"
		incomingPaid := update.Status == "active" || update.Status == "trialing"
		if currentPaid && !incomingPaid {
			return nil
		}
		if currentPaid == incomingPaid {
			created, ok := s.subscriptionCreated[userID]
			if ok && (update.SubscriptionCreatedAt == nil || !update.SubscriptionCreatedAt.After(created)) {
				return nil
			}
		}
	}
	if update.EventCreated != nil {
		if previous, ok := s.eventCreated[userID]; ok && update.EventCreated.Before(previous) {
			return nil
		}
		s.eventCreated[userID] = *update.EventCreated
	}
	if update.CustomerID != "" {
		state.StripeCustomerID = update.CustomerID
	}
	state.StripeSubscriptionID = update.SubscriptionID
	state.StripeSubscriptionStatus = update.Status
	if update.SubscriptionCreatedAt != nil {
		s.subscriptionCreated[userID] = *update.SubscriptionCreatedAt
	}
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

func (s *routeBillingStore) RefreshSubscription(ctx context.Context, userID string, load func(context.Context) (billing.SubscriptionUpdate, error)) error {
	update, err := load(ctx)
	if err != nil {
		return err
	}
	return s.UpdateSubscription(ctx, userID, update)
}

func (s *routeBillingStore) CountSavedDocs(ctx context.Context, userID string) (int, error) {
	return s.savedDocs[userID], nil
}

type routeCommunityStore struct {
	authSessions                                *routeAuthStore
	billingStore                                *routeBillingStore
	createdSlug, receivedSlug, receivedHash     string
	findErr, redeemErr                          error
	rotatedID, disabledID, revokedEmail, reason string
}

func newRouteCommunityStore(authStore *routeAuthStore, billingStore *routeBillingStore) *routeCommunityStore {
	return &routeCommunityStore{authSessions: authStore, billingStore: billingStore}
}

func (s *routeCommunityStore) CreateReferral(_ context.Context, slug, name, codeHash string) (community.StoredReferral, error) {
	s.createdSlug, s.receivedHash = slug, codeHash
	return community.StoredReferral{ID: "11111111-1111-1111-1111-111111111111", Slug: slug, Name: name, CodeHash: codeHash, CreatedAt: time.Unix(1, 0).UTC()}, nil
}

func (s *routeCommunityStore) FindActiveReferral(_ context.Context, slug, codeHash string) (community.StoredReferral, error) {
	s.receivedSlug, s.receivedHash = slug, codeHash
	if s.findErr != nil {
		return community.StoredReferral{}, s.findErr
	}
	return community.StoredReferral{ID: "11111111-1111-1111-1111-111111111111", Slug: slug, Name: "AI Engineer", CodeHash: codeHash}, nil
}

func (s *routeCommunityStore) Redeem(_ context.Context, slug, codeHash, email, _ string, session auth.PreparedSession, _ time.Time) (auth.User, error) {
	s.receivedSlug, s.receivedHash = slug, codeHash
	if s.redeemErr != nil {
		return auth.User{}, s.redeemErr
	}
	user := auth.User{ID: "community-user", Email: email}
	s.authSessions.sessions[session.TokenHash] = user
	s.billingStore.users[email] = user
	s.billingStore.states[user.ID] = billing.State{CommunityAccess: true}
	return user, nil
}

func (s *routeCommunityStore) RotateReferral(_ context.Context, id, codeHash string, _ time.Time) (community.StoredReferral, error) {
	s.rotatedID, s.receivedHash = id, codeHash
	return community.StoredReferral{ID: id, Slug: "aiengineer", Name: "AI Engineer", CodeHash: codeHash}, nil
}

func (s *routeCommunityStore) DisableReferral(_ context.Context, id string, _ time.Time) error {
	s.disabledID = id
	return nil
}
func (s *routeCommunityStore) RevokeGrant(_ context.Context, email, reason string, _ time.Time) error {
	s.revokedEmail, s.reason = email, reason
	return nil
}
