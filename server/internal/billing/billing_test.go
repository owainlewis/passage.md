package billing

import (
	"context"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/config"
)

func TestAccountDerivesPlanSourceLimitsAndUsage(t *testing.T) {
	store := newMemoryStore()
	store.states["user-1"] = State{StripeSubscriptionStatus: "active", StripeCustomerID: "cus_test"}
	store.savedDocs["user-1"] = 7
	service := NewService(store, config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"owner@example.com"},
	})

	account, err := service.Account(context.Background(), auth.User{ID: "user-1", Email: "paid@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != PlanPro || account.Source != SourceStripe {
		t.Fatalf("plan/source = %s/%s", account.Plan, account.Source)
	}
	if account.Limits.MaxSavedDocs != 1000 || account.Usage.SavedDocs != 7 {
		t.Fatalf("limits/usage = %#v/%#v", account.Limits, account.Usage)
	}
	if account.Subscription.StripeCustomerID != "cus_test" {
		t.Fatalf("subscription = %#v", account.Subscription)
	}
}

func TestManualProAndOwnerCompGrantPro(t *testing.T) {
	manual := PlanPro
	store := newMemoryStore()
	store.states["manual"] = State{ManualPlan: &manual}
	service := NewService(store, config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"owner@example.com"},
	})

	manualAccount, err := service.Account(context.Background(), auth.User{ID: "manual", Email: "manual@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if manualAccount.Plan != PlanPro || manualAccount.Source != SourceManual {
		t.Fatalf("manual plan/source = %s/%s", manualAccount.Plan, manualAccount.Source)
	}

	ownerAccount, err := service.Account(context.Background(), auth.User{ID: "owner", Email: "OWNER@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if ownerAccount.Plan != PlanPro || ownerAccount.Source != SourceOwner {
		t.Fatalf("owner plan/source = %s/%s", ownerAccount.Plan, ownerAccount.Source)
	}
}

func TestManualFreeOverrideBeatsStripePaidStatus(t *testing.T) {
	manualFree := PlanFree
	store := newMemoryStore()
	store.states["user-1"] = State{
		ManualPlan:               &manualFree,
		StripeSubscriptionStatus: "active",
	}
	service := NewService(store, config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
	})

	account, err := service.Account(context.Background(), auth.User{ID: "user-1", Email: "paid@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != PlanFree || account.Source != SourceManual {
		t.Fatalf("plan/source = %s/%s", account.Plan, account.Source)
	}
}

func TestEntitlementPrecedenceIncludesCommunity(t *testing.T) {
	manualFree := PlanFree
	store := newMemoryStore()
	store.states["manual"] = State{ManualPlan: &manualFree, CommunityAccess: true, StripeSubscriptionStatus: "active"}
	store.states["owner"] = State{ManualPlan: &manualFree, CommunityAccess: true, StripeSubscriptionStatus: "active"}
	store.states["community"] = State{CommunityAccess: true, StripeSubscriptionStatus: "active"}
	store.states["stripe"] = State{StripeSubscriptionStatus: "trialing"}
	service := NewService(store, config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"owner@example.com"},
	})

	tests := []struct {
		id     string
		email  string
		plan   Plan
		source string
	}{
		{id: "manual", email: "manual@example.com", plan: PlanFree, source: SourceManual},
		{id: "owner", email: "owner@example.com", plan: PlanFree, source: SourceManual},
		{id: "community", email: "community@example.com", plan: PlanPro, source: SourceCommunity},
		{id: "stripe", email: "stripe@example.com", plan: PlanPro, source: SourceStripe},
		{id: "free", email: "free@example.com", plan: PlanFree, source: SourceDefault},
	}
	for _, test := range tests {
		t.Run(test.id, func(t *testing.T) {
			account, err := service.Account(context.Background(), auth.User{ID: test.id, Email: test.email})
			if err != nil {
				t.Fatal(err)
			}
			if account.Plan != test.plan || account.Source != test.source {
				t.Fatalf("plan/source = %s/%s, want %s/%s", account.Plan, account.Source, test.plan, test.source)
			}
		})
	}
}

func TestAdminDashboardSummarizesEffectiveAccounts(t *testing.T) {
	manualFree := PlanFree
	createdAt := time.Date(2026, time.July, 18, 10, 0, 0, 0, time.UTC)
	store := newMemoryStore()
	store.adminUsers = []AdminUserRecord{
		{
			User:      auth.User{ID: "owner", Email: "owner@example.com"},
			CreatedAt: createdAt,
			SavedDocs: 3,
		},
		{
			User:      auth.User{ID: "paid", Email: "paid@example.com"},
			CreatedAt: createdAt.Add(-time.Hour),
			State:     State{StripeSubscriptionStatus: "active"},
			SavedDocs: 8,
		},
		{
			User:      auth.User{ID: "free", Email: "free@example.com"},
			CreatedAt: createdAt.Add(-2 * time.Hour),
			State:     State{ManualPlan: &manualFree, CommunityAccess: true},
		},
	}
	service := NewService(store, config.BillingConfig{
		FreeMaxSavedDocs: 5,
		ProMaxSavedDocs:  1000,
		OwnerEmails:      []string{"owner@example.com"},
	})

	dashboard, err := service.AdminDashboard(context.Background(), auth.User{Email: "OWNER@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.Totals != (AdminTotals{Users: 3, Free: 1, Pro: 2}) {
		t.Fatalf("totals = %#v", dashboard.Totals)
	}
	if dashboard.Users[0].Source != SourceOwner || dashboard.Users[0].SavedDocs != 3 {
		t.Fatalf("owner = %#v", dashboard.Users[0])
	}
	if dashboard.Users[1].Source != SourceStripe || dashboard.Users[1].SubscriptionStatus != "active" {
		t.Fatalf("paid = %#v", dashboard.Users[1])
	}
	if dashboard.Users[2].Plan != PlanFree || dashboard.Users[2].Source != SourceManual {
		t.Fatalf("free = %#v", dashboard.Users[2])
	}

	if _, err := service.AdminDashboard(context.Background(), auth.User{Email: "free@example.com"}); err != ErrNotAdmin {
		t.Fatalf("non-admin error = %v", err)
	}
}

type memoryStore struct {
	users      map[string]auth.User
	states     map[string]State
	savedDocs  map[string]int
	adminUsers []AdminUserRecord
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		users:     map[string]auth.User{},
		states:    map[string]State{},
		savedDocs: map[string]int{},
	}
}

func (s *memoryStore) FindUserByEmail(ctx context.Context, email string) (auth.User, error) {
	user, ok := s.users[email]
	if !ok {
		return auth.User{}, ErrUserNotFound
	}
	return user, nil
}

func (s *memoryStore) FindUserByID(ctx context.Context, userID string) (auth.User, error) {
	for _, user := range s.users {
		if user.ID == userID {
			return user, nil
		}
	}
	return auth.User{}, ErrUserNotFound
}

func (s *memoryStore) FindUserByStripeCustomer(ctx context.Context, customerID string) (auth.User, error) {
	return auth.User{}, ErrUserNotFound
}

func (s *memoryStore) ListAdminUsers(ctx context.Context) ([]AdminUserRecord, error) {
	return s.adminUsers, nil
}

func (s *memoryStore) State(ctx context.Context, userID string) (State, error) {
	return s.states[userID], nil
}

func (s *memoryStore) UpdateOverride(ctx context.Context, userID string, plan *Plan, maxSavedDocs *int) error {
	return nil
}

func (s *memoryStore) SetStripeCustomer(ctx context.Context, userID string, customerID string) (string, error) {
	return customerID, nil
}

func (s *memoryStore) UpdateSubscription(ctx context.Context, userID string, update SubscriptionUpdate) error {
	return nil
}

func (s *memoryStore) RefreshSubscription(ctx context.Context, userID string, load func(context.Context) (SubscriptionUpdate, error)) error {
	update, err := load(ctx)
	if err != nil {
		return err
	}
	return s.UpdateSubscription(ctx, userID, update)
}

func (s *memoryStore) CountSavedDocs(ctx context.Context, userID string) (int, error) {
	return s.savedDocs[userID], nil
}
