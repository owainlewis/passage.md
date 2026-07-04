package billing

import (
	"context"
	"testing"

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

type memoryStore struct {
	users     map[string]auth.User
	states    map[string]State
	savedDocs map[string]int
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

func (s *memoryStore) FindUserByStripeCustomer(ctx context.Context, customerID string) (auth.User, error) {
	return auth.User{}, ErrUserNotFound
}

func (s *memoryStore) State(ctx context.Context, userID string) (State, error) {
	return s.states[userID], nil
}

func (s *memoryStore) UpdateOverride(ctx context.Context, userID string, plan *Plan, maxSavedDocs *int) error {
	return nil
}

func (s *memoryStore) SetStripeCustomer(ctx context.Context, userID string, customerID string) error {
	return nil
}

func (s *memoryStore) UpdateSubscription(ctx context.Context, userID string, update SubscriptionUpdate) error {
	return nil
}

func (s *memoryStore) CountSavedDocs(ctx context.Context, userID string) (int, error) {
	return s.savedDocs[userID], nil
}
