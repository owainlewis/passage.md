package documents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/owainlewis/passage.md/server/internal/auth"
)

const testPublicID = "abcdefghijklmnopqrstuv"

func protectedStore(t *testing.T, password string) (*fakeStore, Document) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	doc := Document{
		ID:                "11111111-1111-1111-1111-111111111111",
		PublicID:          testPublicID,
		Title:             "Quarterly numbers",
		Body:              "# Quarterly numbers\n\nRevenue was 42.",
		SharePasswordHash: string(hash),
		PasswordProtected: true,
	}
	return &fakeStore{publicDoc: doc}, doc
}

func testHandler(store documentStore) *Handler {
	return NewHandlerWithOptions(store, Options{SessionSecret: "test-secret"})
}

func getPublic(h *Handler, token string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "http://passage.test/d/"+token, nil)
	req.SetPathValue("token", token)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.Public(rec, req)
	return rec
}

func unlockJSON(h *Handler, token string, password string) *httptest.ResponseRecorder {
	return unlockJSONFrom(h, token, password, "192.0.2.10:1234")
}

func unlockJSONFrom(h *Handler, token string, password string, remoteAddr string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/d/"+token+"/unlock", strings.NewReader(`{"password":`+quote(password)+`}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = remoteAddr
	req.SetPathValue("token", token)
	rec := httptest.NewRecorder()
	h.Unlock(rec, req)
	return rec
}

func quote(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func unlockCookieFrom(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == unlockCookieName(testPublicID) && cookie.Value != "" {
			return cookie
		}
	}
	t.Fatalf("no unlock cookie in response: %v", rec.Result().Cookies())
	return nil
}

func TestProtectedDocumentHidesBodyAndTitleUntilUnlocked(t *testing.T) {
	store, doc := protectedStore(t, "correct horse")
	rec := getPublic(testHandler(store), testPublicID)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	body := rec.Body.String()
	if strings.Contains(body, doc.Body) || strings.Contains(body, "Revenue was 42") {
		t.Fatal("unlock page leaked the document body")
	}
	if strings.Contains(body, doc.Title) {
		t.Fatal("unlock page leaked the document title")
	}
	if !strings.Contains(body, "This document is protected") {
		t.Fatalf("unlock page not rendered: %s", body)
	}
	assertPublicSecurityHeaders(t, rec)
}

func TestProtectedRawMarkdownRequiresUnlock(t *testing.T) {
	store, doc := protectedStore(t, "correct horse")
	rec := getPublic(testHandler(store), testPublicID+".md")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if strings.Contains(rec.Body.String(), doc.Body) {
		t.Fatal("raw markdown leaked the document body")
	}
}

func TestUnlockWithCorrectPasswordGrantsAccessToHTMLAndRaw(t *testing.T) {
	store, doc := protectedStore(t, "correct horse")
	handler := testHandler(store)

	rec := unlockJSON(handler, testPublicID, "correct horse")
	if rec.Code != http.StatusOK {
		t.Fatalf("unlock status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	cookie := unlockCookieFrom(t, rec)
	if !cookie.HttpOnly {
		t.Fatal("unlock cookie is not HttpOnly")
	}
	if cookie.Path != unlockCookiePath {
		t.Fatalf("unlock cookie path = %q, want %q", cookie.Path, unlockCookiePath)
	}
	if store.unlockResets != 1 {
		t.Fatalf("unlock resets = %d, want 1", store.unlockResets)
	}

	html := getPublic(handler, testPublicID, cookie)
	if html.Code != http.StatusOK {
		t.Fatalf("html status = %d, want 200", html.Code)
	}
	if !strings.Contains(html.Body.String(), "Revenue was 42") {
		t.Fatal("unlocked html did not render the document")
	}

	raw := getPublic(handler, testPublicID+".md", cookie)
	if raw.Code != http.StatusOK {
		t.Fatalf("raw status = %d, want 200", raw.Code)
	}
	if raw.Body.String() != doc.Body {
		t.Fatalf("raw body = %q, want %q", raw.Body.String(), doc.Body)
	}
}

func TestUnlockWithWrongPasswordIsRejected(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	handler := testHandler(store)

	rec := unlockJSON(handler, testPublicID, "wrong horse")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == unlockCookieName(testPublicID) && cookie.Value != "" {
			t.Fatal("wrong password issued an unlock cookie")
		}
	}
	if store.unlockResets != 0 {
		t.Fatal("wrong password reset the rate limit counters")
	}
}

func TestUnlockCookieDoesNotUnlockAnotherDocument(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	handler := testHandler(store)
	cookie := unlockCookieFrom(t, unlockJSON(handler, testPublicID, "correct horse"))

	otherStore, _ := protectedStore(t, "different password")
	otherStore.publicDoc.ID = "22222222-2222-2222-2222-222222222222"
	otherStore.publicDoc.PublicID = "vutsrqponmlkjihgfedcba"

	rec := getPublic(testHandler(otherStore), "vutsrqponmlkjihgfedcba", cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: an unlock cookie crossed documents", rec.Code, http.StatusUnauthorized)
	}
}

func TestChangingPasswordInvalidatesExistingUnlockCookies(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	handler := testHandler(store)
	cookie := unlockCookieFrom(t, unlockJSON(handler, testPublicID, "correct horse"))

	rotated, err := bcrypt.GenerateFromPassword([]byte("new password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	store.publicDoc.SharePasswordHash = string(rotated)

	rec := getPublic(handler, testPublicID, cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: stale cookie survived a password change", rec.Code, http.StatusUnauthorized)
	}
}

func TestExpiredUnlockCookieIsRejected(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	handler := testHandler(store)
	cookie := unlockCookieFrom(t, unlockJSON(handler, testPublicID, "correct horse"))

	handler.now = func() time.Time { return time.Now().Add(unlockLifetime + time.Minute) }

	rec := getPublic(handler, testPublicID, cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: expired cookie was accepted", rec.Code, http.StatusUnauthorized)
	}
}

func TestTamperedUnlockCookieIsRejected(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	handler := testHandler(store)
	cookie := unlockCookieFrom(t, unlockJSON(handler, testPublicID, "correct horse"))

	expiry, _, _ := strings.Cut(cookie.Value, ".")
	cookie.Value = expiry + ".notavalidsignature"

	rec := getPublic(handler, testPublicID, cookie)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: forged signature was accepted", rec.Code, http.StatusUnauthorized)
	}
}

func TestUnlockIsRateLimited(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	store.unlockErr = ErrRateLimited

	rec := unlockJSON(testHandler(store), testPublicID, "guess")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTooManyRequests)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("rate limited response is missing Retry-After")
	}
}

// countingStore applies the real per-key window logic so the rate limit can be
// tested through the handler, including which key each request lands on.
type countingStore struct {
	*fakeStore
	attempts map[string]int
	limit    int
}

func newCountingStore(inner *fakeStore, limit int) *countingStore {
	return &countingStore{fakeStore: inner, attempts: map[string]int{}, limit: limit}
}

func (s *countingStore) ConsumeUnlockAttempt(ctx context.Context, ipHash string, documentHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	limited := false
	for _, key := range []string{"ip:" + ipHash, "doc:" + documentHash} {
		s.attempts[key]++
		if s.attempts[key] > s.limit {
			limited = true
		}
	}
	if limited {
		return time.Minute, ErrRateLimited
	}
	return 0, nil
}

func (s *countingStore) ResetUnlockAttempts(ctx context.Context, documentHash string) error {
	delete(s.attempts, "doc:"+documentHash)
	return nil
}

// Anyone holding a public link can send garbage passwords. If the limiter
// counted the document globally, that would lock every genuine reader out.
func TestFloodingWrongPasswordsDoesNotLockOutOtherReaders(t *testing.T) {
	inner, _ := protectedStore(t, "correct horse")
	store := newCountingStore(inner, 3)
	handler := testHandler(store)

	const attacker = "198.51.100.5:9000"
	for attempt := 1; attempt <= 6; attempt++ {
		unlockJSONFrom(handler, testPublicID, "guess", attacker)
	}
	if rec := unlockJSONFrom(handler, testPublicID, "correct horse", attacker); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("attacker status = %d, want %d: the attacker should be throttled", rec.Code, http.StatusTooManyRequests)
	}

	rec := unlockJSONFrom(handler, testPublicID, "correct horse", "203.0.113.9:4000")
	if rec.Code != http.StatusOK {
		t.Fatalf("genuine reader status = %d, want 200: one client locked out the whole document", rec.Code)
	}
	unlockCookieFrom(t, rec)
}

// Knowing one document's password must not buy a fresh budget for scanning
// other documents from the same IP.
func TestUnlockingOneDocumentDoesNotResetTheCrossDocumentBudget(t *testing.T) {
	inner, _ := protectedStore(t, "correct horse")
	store := newCountingStore(inner, 3)
	handler := testHandler(store)

	const client = "198.51.100.5:9000"
	if rec := unlockJSONFrom(handler, testPublicID, "correct horse", client); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	ipKey := "ip:" + hashKey("198.51.100.5")
	if store.attempts[ipKey] != 1 {
		t.Fatalf("ip counter = %d, want 1: a correct password cleared the cross-document budget", store.attempts[ipKey])
	}
}

func TestUnlockRejectsCrossOriginRequests(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/d/"+testPublicID+"/unlock", strings.NewReader(`{"password":"correct horse"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://evil.test")
	req.SetPathValue("token", testPublicID)
	rec := httptest.NewRecorder()

	testHandler(store).Unlock(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if store.unlockAttempts != 0 {
		t.Fatal("a cross-origin request spent the visitor's unlock budget")
	}
}

func TestUnlockRejectsOversizedBodiesBeforeParsing(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	huge := `{"password":"` + strings.Repeat("a", maxUnlockRequestBytes*2) + `"}`
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/d/"+testPublicID+"/unlock", strings.NewReader(huge))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("token", testPublicID)
	rec := httptest.NewRecorder()

	testHandler(store).Unlock(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
	if store.unlockAttempts != 0 {
		t.Fatal("an oversized body reached the rate limiter")
	}
}

// The unlocked page runs a third-party Mermaid module, which can read
// location.hash. The key must be gone from the URL before that page loads.
func TestUnlockPageStripsTheKeyFromTheURL(t *testing.T) {
	page, err := renderUnlockPage(testPublicID, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(page), "history.replaceState") {
		t.Fatal("unlock page does not strip the fragment key before unlocking")
	}
}

func TestSetSharePasswordRejectsPasswordsBcryptCannotHash(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	// bcrypt refuses anything over 72 bytes; this must be a 400, never a 500.
	long := strings.Repeat("a", 73)
	req := httptest.NewRequest(http.MethodPut, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share/password", strings.NewReader(`{"password":`+quote(long)+`}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://passage.test")
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()

	testHandler(store).SetSharePassword(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if store.sharePasswordHash != "" {
		t.Fatal("an unhashable password was stored")
	}
}

func TestSetSharePasswordAcceptsThePasswordAtTheBcryptLimit(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	atLimit := strings.Repeat("a", 72)
	req := httptest.NewRequest(http.MethodPut, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share/password", strings.NewReader(`{"password":`+quote(atLimit)+`}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://passage.test")
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()

	testHandler(store).SetSharePassword(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: body = %s", rec.Code, rec.Body.String())
	}
}

// Legacy share-token URLs still exist. The gate must cover them, and the cookie
// must key on the document's public ID rather than the requested token.
func TestLegacyShareTokenURLIsAlsoGated(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	legacy := strings.Repeat("a", 43)
	store.publicDoc.ShareToken = &legacy

	locked := getPublic(testHandler(store), legacy)
	if locked.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", locked.Code, http.StatusUnauthorized)
	}
	if strings.Contains(locked.Body.String(), "Revenue was 42") {
		t.Fatal("legacy share token URL leaked the body")
	}

	handler := testHandler(store)
	cookie := unlockCookieFrom(t, unlockJSON(handler, legacy, "correct horse"))
	if cookie.Name != unlockCookieName(testPublicID) {
		t.Fatalf("cookie name = %q, want it keyed on the public id", cookie.Name)
	}
	unlocked := getPublic(handler, legacy, cookie)
	if unlocked.Code != http.StatusOK {
		t.Fatalf("unlocked status = %d, want 200", unlocked.Code)
	}
}

func TestUnprotectedDocumentIsUnaffected(t *testing.T) {
	store := &fakeStore{publicDoc: Document{
		ID:       "11111111-1111-1111-1111-111111111111",
		PublicID: testPublicID,
		Title:    "Open doc",
		Body:     "# Open doc",
	}}

	rec := getPublic(testHandler(store), testPublicID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Open doc") {
		t.Fatal("unprotected document did not render")
	}
}

func TestUnlockFormPostRedirectsWithoutJavaScript(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	req := httptest.NewRequest(http.MethodPost, "http://passage.test/d/"+testPublicID+"/unlock", strings.NewReader("password=correct+horse"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetPathValue("token", testPublicID)
	rec := httptest.NewRecorder()

	testHandler(store).Unlock(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusSeeOther)
	}
	if got := rec.Header().Get("Location"); got != "/d/"+testPublicID {
		t.Fatalf("Location = %q", got)
	}
	unlockCookieFrom(t, rec)
}

func TestSetSharePasswordRejectsShortPasswords(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	req := httptest.NewRequest(http.MethodPut, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share/password", strings.NewReader(`{"password":"abc"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://passage.test")
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()

	testHandler(store).SetSharePassword(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if store.sharePasswordHash != "" {
		t.Fatal("short password was stored")
	}
}

func TestSetSharePasswordRequiresASharedDocument(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	store.sharePasswordErr = ErrNotShared
	req := httptest.NewRequest(http.MethodPut, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share/password", strings.NewReader(`{"password":"a good password"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://passage.test")
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()

	testHandler(store).SetSharePassword(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusConflict)
	}
}

func TestSetSharePasswordStoresABcryptHashNotThePassword(t *testing.T) {
	store, _ := protectedStore(t, "correct horse")
	req := httptest.NewRequest(http.MethodPut, "http://passage.test/api/v1/docs/11111111-1111-1111-1111-111111111111/share/password", strings.NewReader(`{"password":"a good password"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://passage.test")
	req.SetPathValue("id", "11111111-1111-1111-1111-111111111111")
	rec := httptest.NewRecorder()

	testHandler(store).SetSharePassword(rec, req, auth.User{ID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if store.sharePasswordHash == "a good password" {
		t.Fatal("share password was stored in plain text")
	}
	if bcrypt.CompareHashAndPassword([]byte(store.sharePasswordHash), []byte("a good password")) != nil {
		t.Fatal("stored value is not a bcrypt hash of the password")
	}
	if strings.Contains(rec.Body.String(), store.sharePasswordHash) {
		t.Fatal("share response leaked the password hash")
	}
	if !strings.Contains(rec.Body.String(), `"passwordProtected":true`) {
		t.Fatalf("share response did not report protection: %s", rec.Body.String())
	}
}
