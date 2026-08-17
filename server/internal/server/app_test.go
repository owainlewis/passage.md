package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/community"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

type routeAuthStore struct {
	users                   map[string]auth.User
	sessions                map[string]auth.User
	revoked                 map[string]bool
	createdUser             auth.User
	createdPasswordHash     string
	createdPolicyVersion    string
	createdPolicyAcceptedAt time.Time
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

func (s *routeAuthStore) CreateUser(ctx context.Context, email string, passwordHash string, policyVersion string, policyAcceptedAt time.Time) (auth.User, error) {
	if s.createdUser.Email == email {
		return auth.User{}, auth.ErrEmailTaken
	}
	s.createdUser = auth.User{ID: "registered-user", Email: email}
	s.createdPasswordHash = passwordHash
	s.createdPolicyVersion = policyVersion
	s.createdPolicyAcceptedAt = policyAcceptedAt
	return s.createdUser, nil
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
	if userID == s.createdUser.ID {
		s.sessions[tokenHash] = s.createdUser
		return nil
	}
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

func (s *routeAuthStore) FindActorByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (auth.Actor, error) {
	if s.revoked[tokenHash] {
		return auth.Actor{}, auth.ErrUnauthorized
	}
	user, ok := s.users[tokenHash]
	if !ok {
		return auth.Actor{}, auth.ErrUnauthorized
	}
	return auth.Actor{User: user, TokenID: "token-" + tokenHash[:8], TokenName: "Test token"}, nil
}

func (s *routeAuthStore) FindActorByAPITokenHashReadOnly(ctx context.Context, tokenHash string) (auth.Actor, error) {
	return s.FindActorByAPITokenHash(ctx, tokenHash, time.Time{})
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

func (s *routeDocumentStore) ListPage(ctx context.Context, ownerID string, limit int, cursor *documents.ListCursor) ([]documents.DocumentMetadata, error) {
	s.ownerID = ownerID
	return []documents.DocumentMetadata{}, nil
}

func (s *routeDocumentStore) Search(ctx context.Context, ownerID string, query string, scope documents.SearchScope, limit int, cursor *documents.SearchCursor) ([]documents.SearchResult, error) {
	s.ownerID = ownerID
	return []documents.SearchResult{}, nil
}

func (s *routeDocumentStore) Contributors(ctx context.Context, ownerID string, id string) ([]documents.Contributor, error) {
	return nil, nil
}

func (s *routeDocumentStore) Create(ctx context.Context, ownerID string, body string, maxSavedDocs int, actor documents.Actor) (documents.Document, error) {
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

func (s *routeDocumentStore) Update(ctx context.Context, ownerID string, id string, update documents.DocumentUpdate) (documents.Document, error) {
	s.ownerID = ownerID
	if ownerID != "user-1" || id != "11111111-1111-1111-1111-111111111111" {
		return documents.Document{}, documents.ErrNotFound
	}
	if update.Body != nil {
		s.body = *update.Body
	}
	return documents.Document{ID: id, PublicID: "abcdefghijklmnopqrstuv", Title: "Token doc", Body: s.body}, nil
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
	users                            map[string]auth.User
	states                           map[string]billing.State
	eventCreated                     map[string]time.Time
	subscriptionCreated              map[string]time.Time
	savedDocs                        map[string]int
	adminUsers                       []billing.AdminUserRecord
	updateSubscriptionErr            error
	setStripeCustomerErr             error
	setStripeCustomerResult          string
	setStripeCustomerHook            func()
	persistStripeCustomerBeforeError bool
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
		if s.persistStripeCustomerBeforeError {
			state := s.states[userID]
			state.StripeCustomerID = customerID
			s.states[userID] = state
		}
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
	receivedPolicyVersion                       string
	receivedPolicyAcceptedAt                    time.Time
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

func (s *routeCommunityStore) Redeem(_ context.Context, slug, codeHash, email, _, policyVersion string, session auth.PreparedSession, acceptedAt time.Time) (auth.User, error) {
	s.receivedSlug, s.receivedHash = slug, codeHash
	s.receivedPolicyVersion, s.receivedPolicyAcceptedAt = policyVersion, acceptedAt
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
func (s *routeCommunityStore) DisableReferralBySlug(_ context.Context, _ string, _ time.Time) error {
	return nil
}
func (s *routeCommunityStore) RevokeGrant(_ context.Context, email, reason string, _ time.Time) error {
	s.revokedEmail, s.reason = email, reason
	return nil
}
