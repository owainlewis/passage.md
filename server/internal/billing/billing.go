package billing

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/config"
)

type Plan string

const (
	PlanFree Plan = "free"
	PlanPro  Plan = "pro"
)

const (
	SourceDefault = "default"
	SourceOwner   = "owner"
	SourceManual  = "manual"
	SourceStripe  = "stripe"
)

var ErrLimitReached = errors.New("saved document limit reached")
var ErrPaidRequired = errors.New("pro plan required")
var ErrNotAdmin = errors.New("admin access required")
var ErrUserNotFound = errors.New("user not found")

type Limits struct {
	MaxSavedDocs int `json:"maxSavedDocs"`
}

type Usage struct {
	SavedDocs int `json:"savedDocs"`
}

type Subscription struct {
	StripeCustomerID     string     `json:"stripeCustomerId,omitempty"`
	StripeSubscriptionID string     `json:"stripeSubscriptionId,omitempty"`
	Status               string     `json:"status,omitempty"`
	PriceID              string     `json:"priceId,omitempty"`
	CurrentPeriodEnd     *time.Time `json:"currentPeriodEnd,omitempty"`
	CancelAtPeriodEnd    bool       `json:"cancelAtPeriodEnd"`
}

type Account struct {
	Plan         Plan         `json:"plan"`
	Source       string       `json:"source"`
	Limits       Limits       `json:"limits"`
	Usage        Usage        `json:"usage"`
	Subscription Subscription `json:"subscription"`
}

type State struct {
	ManualPlan               *Plan
	MaxSavedDocs             *int
	StripeCustomerID         string
	StripeSubscriptionID     string
	StripeSubscriptionStatus string
	StripePriceID            string
	StripeCurrentPeriodEnd   *time.Time
	StripeCancelAtPeriodEnd  bool
}

type SubscriptionUpdate struct {
	CustomerID        string
	SubscriptionID    string
	Status            string
	PriceID           string
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd *bool
	EventCreated      *time.Time
}

type Store interface {
	FindUserByEmail(ctx context.Context, email string) (auth.User, error)
	FindUserByStripeCustomer(ctx context.Context, customerID string) (auth.User, error)
	State(ctx context.Context, userID string) (State, error)
	UpdateOverride(ctx context.Context, userID string, plan *Plan, maxSavedDocs *int) error
	SetStripeCustomer(ctx context.Context, userID string, customerID string) error
	UpdateSubscription(ctx context.Context, userID string, update SubscriptionUpdate) error
	CountSavedDocs(ctx context.Context, userID string) (int, error)
}

type Service struct {
	store       Store
	freeLimit   int
	proLimit    int
	ownerEmails map[string]struct{}
}

func NewService(store Store, cfg config.BillingConfig) *Service {
	owners := map[string]struct{}{}
	for _, email := range cfg.OwnerEmails {
		normalized := normalizeEmail(email)
		if normalized != "" {
			owners[normalized] = struct{}{}
		}
	}
	return &Service{
		store:       store,
		freeLimit:   cfg.FreeMaxSavedDocs,
		proLimit:    cfg.ProMaxSavedDocs,
		ownerEmails: owners,
	}
}

func (s *Service) Account(ctx context.Context, user auth.User) (Account, error) {
	state, err := s.store.State(ctx, user.ID)
	if err != nil {
		return Account{}, err
	}
	usage, err := s.store.CountSavedDocs(ctx, user.ID)
	if err != nil {
		return Account{}, err
	}
	return s.accountFromState(user.Email, state, usage), nil
}

func (s *Service) AdminAccountByEmail(ctx context.Context, admin auth.User, email string) (auth.User, Account, error) {
	if !s.IsAdmin(admin.Email) {
		return auth.User{}, Account{}, ErrNotAdmin
	}
	user, err := s.store.FindUserByEmail(ctx, normalizeEmail(email))
	if err != nil {
		return auth.User{}, Account{}, err
	}
	account, err := s.Account(ctx, user)
	return user, account, err
}

func (s *Service) UpdateAdminOverride(ctx context.Context, admin auth.User, email string, plan *Plan, maxSavedDocs *int) (auth.User, Account, error) {
	if !s.IsAdmin(admin.Email) {
		return auth.User{}, Account{}, ErrNotAdmin
	}
	if plan != nil && !validPlan(*plan) {
		return auth.User{}, Account{}, errors.New("invalid plan")
	}
	if maxSavedDocs != nil && *maxSavedDocs < 0 {
		return auth.User{}, Account{}, errors.New("invalid saved document limit")
	}
	user, err := s.store.FindUserByEmail(ctx, normalizeEmail(email))
	if err != nil {
		return auth.User{}, Account{}, err
	}
	if err := s.store.UpdateOverride(ctx, user.ID, plan, maxSavedDocs); err != nil {
		return auth.User{}, Account{}, err
	}
	account, err := s.Account(ctx, user)
	return user, account, err
}

func (s *Service) EnsureCanCreateDoc(ctx context.Context, user auth.User) (Account, error) {
	account, err := s.Account(ctx, user)
	if err != nil {
		return Account{}, err
	}
	if account.Usage.SavedDocs >= account.Limits.MaxSavedDocs {
		return account, ErrLimitReached
	}
	return account, nil
}

func (s *Service) EnsurePro(ctx context.Context, user auth.User) (Account, error) {
	account, err := s.Account(ctx, user)
	if err != nil {
		return Account{}, err
	}
	if account.Plan != PlanPro {
		return account, ErrPaidRequired
	}
	return account, nil
}

func (s *Service) IsAdmin(email string) bool {
	_, ok := s.ownerEmails[normalizeEmail(email)]
	return ok
}

func (s *Service) SetStripeCustomer(ctx context.Context, userID string, customerID string) error {
	return s.store.SetStripeCustomer(ctx, userID, customerID)
}

func (s *Service) UserByStripeCustomer(ctx context.Context, customerID string) (auth.User, error) {
	return s.store.FindUserByStripeCustomer(ctx, customerID)
}

func (s *Service) UpdateSubscription(ctx context.Context, userID string, update SubscriptionUpdate) error {
	return s.store.UpdateSubscription(ctx, userID, update)
}

func (s *Service) accountFromState(email string, state State, savedDocs int) Account {
	plan := PlanFree
	source := SourceDefault
	if s.IsAdmin(email) {
		plan = PlanPro
		source = SourceOwner
	} else if state.ManualPlan != nil {
		source = SourceManual
		if *state.ManualPlan == PlanPro {
			plan = PlanPro
		}
	} else if stripeStatusIsPaid(state.StripeSubscriptionStatus) {
		plan = PlanPro
		source = SourceStripe
	}

	maxDocs := s.freeLimit
	if plan == PlanPro {
		maxDocs = s.proLimit
	}
	if state.MaxSavedDocs != nil {
		maxDocs = *state.MaxSavedDocs
	}

	return Account{
		Plan:   plan,
		Source: source,
		Limits: Limits{MaxSavedDocs: maxDocs},
		Usage:  Usage{SavedDocs: savedDocs},
		Subscription: Subscription{
			StripeCustomerID:     state.StripeCustomerID,
			StripeSubscriptionID: state.StripeSubscriptionID,
			Status:               state.StripeSubscriptionStatus,
			PriceID:              state.StripePriceID,
			CurrentPeriodEnd:     state.StripeCurrentPeriodEnd,
			CancelAtPeriodEnd:    state.StripeCancelAtPeriodEnd,
		},
	}
}

func stripeStatusIsPaid(status string) bool {
	return status == "active" || status == "trialing"
}

func validPlan(plan Plan) bool {
	return plan == PlanFree || plan == PlanPro
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
