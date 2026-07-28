package billing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func (s *PGStore) FindUserByID(ctx context.Context, userID string) (auth.User, error) {
	var user auth.User
	err := s.db.QueryRow(ctx, `
		SELECT id::text, email
		FROM users
		WHERE id::text = $1
	`, userID).Scan(&user.ID, &user.Email)
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

func (s *PGStore) ListAdminUsers(ctx context.Context) ([]AdminUserRecord, error) {
	rows, err := s.db.Query(ctx, `
		WITH document_usage AS (
			SELECT owner_user_id,
			       count(*) FILTER (WHERE archived_at IS NULL) AS saved_docs,
			       COALESCE(sum(octet_length(body)), 0) AS stored_markdown_bytes
			FROM documents
			GROUP BY owner_user_id
		)
		SELECT users.id::text,
		       users.email,
		       users.created_at,
		       billing_accounts.manual_plan,
		       billing_accounts.max_saved_docs,
		       EXISTS (
		         SELECT 1
		         FROM community_grants
		         WHERE user_id = users.id
		           AND revoked_at IS NULL
		       ),
		       COALESCE(billing_accounts.stripe_customer_id, ''),
		       COALESCE(billing_accounts.stripe_subscription_id, ''),
		       COALESCE(billing_accounts.stripe_subscription_status, ''),
		       COALESCE(billing_accounts.stripe_price_id, ''),
		       billing_accounts.stripe_current_period_end,
		       COALESCE(billing_accounts.stripe_cancel_at_period_end, false),
		       COALESCE(document_usage.saved_docs, 0),
		       COALESCE(document_usage.stored_markdown_bytes, 0)
		FROM users
		LEFT JOIN billing_accounts ON billing_accounts.user_id = users.id
		LEFT JOIN document_usage ON document_usage.owner_user_id = users.id
		ORDER BY users.created_at DESC, users.email
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []AdminUserRecord{}
	for rows.Next() {
		var record AdminUserRecord
		var manualPlan *string
		if err := rows.Scan(
			&record.User.ID,
			&record.User.Email,
			&record.CreatedAt,
			&manualPlan,
			&record.State.MaxSavedDocs,
			&record.State.CommunityAccess,
			&record.State.StripeCustomerID,
			&record.State.StripeSubscriptionID,
			&record.State.StripeSubscriptionStatus,
			&record.State.StripePriceID,
			&record.State.StripeCurrentPeriodEnd,
			&record.State.StripeCancelAtPeriodEnd,
			&record.SavedDocs,
			&record.StoredMarkdownBytes,
		); err != nil {
			return nil, err
		}
		if manualPlan != nil {
			plan := Plan(*manualPlan)
			record.State.ManualPlan = &plan
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *PGStore) State(ctx context.Context, userID string) (State, error) {
	var state State
	var manualPlan *string
	err := s.db.QueryRow(ctx, `
		SELECT billing_accounts.manual_plan,
		       billing_accounts.max_saved_docs,
		       EXISTS (
		         SELECT 1
		         FROM community_grants
		         WHERE user_id = $1
		           AND revoked_at IS NULL
		       ),
		       COALESCE(billing_accounts.stripe_customer_id, ''),
		       COALESCE(billing_accounts.stripe_subscription_id, ''),
		       COALESCE(billing_accounts.stripe_subscription_status, ''),
		       COALESCE(billing_accounts.stripe_price_id, ''),
		       billing_accounts.stripe_current_period_end,
		       COALESCE(billing_accounts.stripe_cancel_at_period_end, false)
		FROM users
		LEFT JOIN billing_accounts ON billing_accounts.user_id = users.id
		WHERE users.id = $1
	`, userID).Scan(
		&manualPlan,
		&state.MaxSavedDocs,
		&state.CommunityAccess,
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

func (s *PGStore) SetStripeCustomer(ctx context.Context, userID string, customerID string) (string, error) {
	var storedCustomerID string
	err := s.db.QueryRow(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_customer_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET stripe_customer_id = COALESCE(billing_accounts.stripe_customer_id, EXCLUDED.stripe_customer_id),
		    updated_at = CASE
		      WHEN billing_accounts.stripe_customer_id IS NULL THEN now()
		      ELSE billing_accounts.updated_at
		    END
		RETURNING stripe_customer_id
	`, userID, customerID).Scan(&storedCustomerID)
	return storedCustomerID, err
}

func (s *PGStore) UpdateSubscription(ctx context.Context, userID string, update SubscriptionUpdate) error {
	_, err := updateSubscription(ctx, s.db, userID, update)
	return err
}

func (s *PGStore) RefreshSubscription(ctx context.Context, userID string, load func(context.Context) (SubscriptionUpdate, error)) error {
	// Reserve an order before calling Stripe, without holding a database
	// connection while the network request is in flight.
	var generation int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO billing_accounts (user_id, stripe_refresh_generation)
		VALUES ($1, 1)
		ON CONFLICT (user_id) DO UPDATE
		SET stripe_refresh_generation = billing_accounts.stripe_refresh_generation + 1
		RETURNING stripe_refresh_generation
	`, userID).Scan(&generation)
	if err != nil {
		return err
	}

	update, err := load(ctx)
	if err != nil {
		return err
	}

	// Only the newest completed refresh may update the account. A failed newer
	// refresh leaves room for an older successful request to apply.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var appliedGeneration int64
	if err := tx.QueryRow(ctx, `
		SELECT stripe_refresh_applied_generation
		FROM billing_accounts
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(&appliedGeneration); err != nil {
		return err
	}
	if generation <= appliedGeneration {
		return tx.Commit(ctx)
	}
	var refreshedAt time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&refreshedAt); err != nil {
		return err
	}
	update.EventCreated = &refreshedAt
	applied, err := updateSubscription(ctx, tx, userID, update)
	if err != nil {
		return err
	}
	if !applied {
		return tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE billing_accounts
		SET stripe_refresh_applied_generation = $2
		WHERE user_id = $1
	`, userID, generation); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type subscriptionExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func updateSubscription(ctx context.Context, executor subscriptionExecutor, userID string, update SubscriptionUpdate) (bool, error) {
	tag, err := executor.Exec(ctx, `
		INSERT INTO billing_accounts (
			user_id,
			stripe_customer_id,
			stripe_subscription_id,
			stripe_subscription_created,
			stripe_subscription_status,
			stripe_price_id,
			stripe_current_period_end,
			stripe_cancel_at_period_end,
			stripe_event_created
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id) DO UPDATE
		SET stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, billing_accounts.stripe_customer_id),
		    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
		    stripe_subscription_created = CASE
		      WHEN billing_accounts.stripe_subscription_id = EXCLUDED.stripe_subscription_id
		        THEN COALESCE(EXCLUDED.stripe_subscription_created, billing_accounts.stripe_subscription_created)
		      ELSE EXCLUDED.stripe_subscription_created
		    END,
		    stripe_subscription_status = EXCLUDED.stripe_subscription_status,
		    stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, billing_accounts.stripe_price_id),
		    stripe_current_period_end = COALESCE(EXCLUDED.stripe_current_period_end, billing_accounts.stripe_current_period_end),
		    stripe_cancel_at_period_end = COALESCE(EXCLUDED.stripe_cancel_at_period_end, billing_accounts.stripe_cancel_at_period_end),
		    stripe_event_created = EXCLUDED.stripe_event_created,
		    updated_at = now()
		WHERE (
		    billing_accounts.stripe_event_created IS NULL
		    OR EXCLUDED.stripe_event_created IS NULL
		    OR EXCLUDED.stripe_event_created >= billing_accounts.stripe_event_created
		  )
		  AND (
		    billing_accounts.stripe_customer_id IS NULL
		    OR billing_accounts.stripe_customer_id = EXCLUDED.stripe_customer_id
		  )
		  AND (
		    billing_accounts.stripe_subscription_id IS NULL
		    OR billing_accounts.stripe_subscription_id = EXCLUDED.stripe_subscription_id
		    OR (
		      COALESCE(EXCLUDED.stripe_subscription_status IN ('active', 'trialing'), false)
		      AND NOT COALESCE(billing_accounts.stripe_subscription_status IN ('active', 'trialing'), false)
		    )
		    OR (
		      COALESCE(EXCLUDED.stripe_subscription_status IN ('active', 'trialing'), false)
		        = COALESCE(billing_accounts.stripe_subscription_status IN ('active', 'trialing'), false)
		      AND (
		        billing_accounts.stripe_subscription_created IS NULL
		        OR (
		          EXCLUDED.stripe_subscription_created IS NOT NULL
		          AND EXCLUDED.stripe_subscription_created > billing_accounts.stripe_subscription_created
		        )
		      )
		    )
		  )
	`, userID, emptyToNil(update.CustomerID), update.SubscriptionID, update.SubscriptionCreatedAt, update.Status, emptyToNil(update.PriceID), update.CurrentPeriodEnd, update.CancelAtPeriodEnd, update.EventCreated)
	return tag.RowsAffected() > 0, err
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
