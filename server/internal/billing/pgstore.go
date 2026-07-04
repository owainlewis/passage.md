package billing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/database"
)

type PGStore struct {
	db *database.Pool
}

func NewPGStore(db *database.Pool) *PGStore {
	return &PGStore{db: db}
}

func (s *PGStore) FindUserByEmail(ctx context.Context, email string) (auth.User, error) {
	var user auth.User
	err := s.db.QueryRow(ctx, `
		SELECT id::text, email
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, ErrUserNotFound
	}
	return user, err
}

func (s *PGStore) FindUserByStripeCustomer(ctx context.Context, customerID string) (auth.User, error) {
	var user auth.User
	err := s.db.QueryRow(ctx, `
		SELECT users.id::text, users.email
		FROM billing_accounts
		JOIN users ON users.id = billing_accounts.user_id
		WHERE billing_accounts.stripe_customer_id = $1
	`, customerID).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, ErrUserNotFound
	}
	return user, err
}

func (s *PGStore) State(ctx context.Context, userID string) (State, error) {
	var state State
	var manualPlan *string
	err := s.db.QueryRow(ctx, `
		SELECT manual_plan,
		       max_saved_docs,
		       COALESCE(stripe_customer_id, ''),
		       COALESCE(stripe_subscription_id, ''),
		       COALESCE(stripe_subscription_status, ''),
		       COALESCE(stripe_price_id, ''),
		       stripe_current_period_end,
		       stripe_cancel_at_period_end
		FROM billing_accounts
		WHERE user_id = $1
	`, userID).Scan(
		&manualPlan,
		&state.MaxSavedDocs,
		&state.StripeCustomerID,
		&state.StripeSubscriptionID,
		&state.StripeSubscriptionStatus,
		&state.StripePriceID,
		&state.StripeCurrentPeriodEnd,
		&state.StripeCancelAtPeriodEnd,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return State{}, nil
	}
	if err != nil {
		return State{}, err
	}
	if manualPlan != nil {
		plan := Plan(*manualPlan)
		state.ManualPlan = &plan
	}
	return state, nil
}

func (s *PGStore) UpdateOverride(ctx context.Context, userID string, plan *Plan, maxSavedDocs *int) error {
	var planValue *string
	if plan != nil {
		value := string(*plan)
		planValue = &value
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, manual_plan, max_saved_docs)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET manual_plan = EXCLUDED.manual_plan,
		    max_saved_docs = EXCLUDED.max_saved_docs,
		    updated_at = now()
	`, userID, planValue, maxSavedDocs)
	return err
}

func (s *PGStore) SetStripeCustomer(ctx context.Context, userID string, customerID string) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET stripe_customer_id = EXCLUDED.stripe_customer_id,
		    updated_at = now()
	`, userID, customerID)
	return err
}

func (s *PGStore) UpdateSubscription(ctx context.Context, userID string, update SubscriptionUpdate) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO billing_accounts (
			user_id,
			stripe_customer_id,
			stripe_subscription_id,
			stripe_subscription_status,
			stripe_price_id,
			stripe_current_period_end,
			stripe_cancel_at_period_end,
			stripe_event_created
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id) DO UPDATE
		SET stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, billing_accounts.stripe_customer_id),
		    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
		    stripe_subscription_status = EXCLUDED.stripe_subscription_status,
		    stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, billing_accounts.stripe_price_id),
		    stripe_current_period_end = COALESCE(EXCLUDED.stripe_current_period_end, billing_accounts.stripe_current_period_end),
		    stripe_cancel_at_period_end = COALESCE(EXCLUDED.stripe_cancel_at_period_end, billing_accounts.stripe_cancel_at_period_end),
		    stripe_event_created = EXCLUDED.stripe_event_created,
		    updated_at = now()
		WHERE billing_accounts.stripe_event_created IS NULL
		   OR EXCLUDED.stripe_event_created IS NULL
		   OR EXCLUDED.stripe_event_created >= billing_accounts.stripe_event_created
	`, userID, emptyToNil(update.CustomerID), update.SubscriptionID, update.Status, emptyToNil(update.PriceID), update.CurrentPeriodEnd, update.CancelAtPeriodEnd, update.EventCreated)
	return err
}

func (s *PGStore) CountSavedDocs(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT count(*)
		FROM documents
		WHERE owner_user_id = $1
		  AND archived_at IS NULL
	`, userID).Scan(&count)
	return count, err
}

func emptyToNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
