package community

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/migrations"
)

func TestPGStoreRedemptionIsAtomicAndSingleUse(t *testing.T) {
	db := integrationDB(t)
	store := NewPGStore(db)
	ctx := context.Background()
	stamp := time.Now().UnixNano()

	t.Run("session failure rolls back user and code", func(t *testing.T) {
		hash := HashCode(fmt.Sprintf("rollback-%d", stamp))
		codes, err := store.CreateCodes(ctx, "rollback", []string{hash})
		if err != nil {
			t.Fatal(err)
		}
		existingUser := insertIntegrationUser(t, db, fmt.Sprintf("existing-%d@example.com", stamp))
		collision := auth.PreparedSession{TokenHash: fmt.Sprintf("collision-%d", stamp), ExpiresAt: time.Now().Add(time.Hour)}
		if _, err := db.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, existingUser, collision.TokenHash, collision.ExpiresAt); err != nil {
			t.Fatal(err)
		}
		email := fmt.Sprintf("rollback-%d@example.com", stamp)
		if _, err := store.Redeem(ctx, hash, email, "hash", collision, time.Now()); err == nil {
			t.Fatal("redeem succeeded despite duplicate session token")
		}
		var users int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = $1`, email).Scan(&users); err != nil {
			t.Fatal(err)
		}
		var redeemed bool
		if err := db.QueryRow(ctx, `SELECT redeemed_user_id IS NOT NULL FROM community_access_codes WHERE id = $1`, codes[0].ID).Scan(&redeemed); err != nil {
			t.Fatal(err)
		}
		if users != 0 || redeemed {
			t.Fatalf("users/redeemed = %d/%v", users, redeemed)
		}
		if redeemable, err := store.CanRedeem(ctx, hash); err != nil || !redeemable {
			t.Fatalf("rolled-back code redeemable/error = %v/%v", redeemable, err)
		}
	})

	t.Run("concurrent redemption creates one account", func(t *testing.T) {
		hash := HashCode(fmt.Sprintf("concurrent-%d", stamp))
		if _, err := store.CreateCodes(ctx, "concurrent", []string{hash}); err != nil {
			t.Fatal(err)
		}
		var successes atomic.Int32
		var invalid atomic.Int32
		var wg sync.WaitGroup
		for i := range 2 {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				session := auth.PreparedSession{TokenHash: fmt.Sprintf("session-%d-%d", stamp, i), ExpiresAt: time.Now().Add(time.Hour)}
				_, err := store.Redeem(ctx, hash, fmt.Sprintf("concurrent-%d-%d@example.com", stamp, i), "hash", session, time.Now())
				if err == nil {
					successes.Add(1)
				} else if errors.Is(err, ErrInvalidCode) {
					invalid.Add(1)
				} else {
					t.Errorf("redeem %d: %v", i, err)
				}
			}(i)
		}
		wg.Wait()
		if successes.Load() != 1 || invalid.Load() != 1 {
			t.Fatalf("success/invalid = %d/%d", successes.Load(), invalid.Load())
		}
		if redeemable, err := store.CanRedeem(ctx, hash); err != nil || redeemable {
			t.Fatalf("used code redeemable/error = %v/%v", redeemable, err)
		}
	})
}

func TestPGStoreDisableAndRevokeAffectGrantWithoutBillingState(t *testing.T) {
	db := integrationDB(t)
	store := NewPGStore(db)
	ctx := context.Background()
	stamp := time.Now().UnixNano()

	disabledHash := HashCode(fmt.Sprintf("disabled-%d", stamp))
	disabledCodes, err := store.CreateCodes(ctx, "disabled", []string{disabledHash})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Invalidate(ctx, disabledCodes[0].ID, "sent to wrong person", time.Now()); err != nil {
		t.Fatal(err)
	}
	if redeemable, err := store.CanRedeem(ctx, disabledHash); err != nil || redeemable {
		t.Fatalf("disabled code redeemable/error = %v/%v", redeemable, err)
	}
	if _, err := store.Redeem(ctx, disabledHash, fmt.Sprintf("disabled-%d@example.com", stamp), "hash", auth.PreparedSession{TokenHash: fmt.Sprintf("disabled-session-%d", stamp), ExpiresAt: time.Now().Add(time.Hour)}, time.Now()); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("disabled redeem error = %v", err)
	}

	redeemedHash := HashCode(fmt.Sprintf("redeemed-%d", stamp))
	redeemedCodes, err := store.CreateCodes(ctx, "redeemed", []string{redeemedHash})
	if err != nil {
		t.Fatal(err)
	}
	if redeemable, err := store.CanRedeem(ctx, redeemedHash); err != nil || !redeemable {
		t.Fatalf("unused code redeemable/error = %v/%v", redeemable, err)
	}
	user, err := store.Redeem(ctx, redeemedHash, fmt.Sprintf("redeemed-%d@example.com", stamp), "hash", auth.PreparedSession{TokenHash: fmt.Sprintf("redeemed-session-%d", stamp), ExpiresAt: time.Now().Add(time.Hour)}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if redeemable, err := store.CanRedeem(ctx, redeemedHash); err != nil || redeemable {
		t.Fatalf("used code redeemable/error = %v/%v", redeemable, err)
	}
	var billingRows int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM billing_accounts WHERE user_id = $1`, user.ID).Scan(&billingRows); err != nil {
		t.Fatal(err)
	}
	if billingRows != 0 {
		t.Fatalf("billing account rows = %d", billingRows)
	}
	billingService := billing.NewService(billing.NewPGStore(db), config.BillingConfig{FreeMaxSavedDocs: 5, ProMaxSavedDocs: 1000})
	account, err := billingService.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro || account.Source != billing.SourceCommunity {
		t.Fatalf("community plan/source = %s/%s", account.Plan, account.Source)
	}
	if account.Subscription.StripeCustomerID != "" || account.Subscription.StripeSubscriptionID != "" || account.Subscription.Status != "" {
		t.Fatalf("community subscription is not empty: %#v", account.Subscription)
	}
	if err := store.Invalidate(ctx, redeemedCodes[0].ID, "membership ended", time.Now()); err != nil {
		t.Fatal(err)
	}
	var active bool
	if err := db.QueryRow(ctx, `SELECT revoked_at IS NULL FROM community_access_codes WHERE id = $1`, redeemedCodes[0].ID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active {
		t.Fatal("revoked code remains active")
	}
	account, err = billingService.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanFree || account.Source != billing.SourceDefault {
		t.Fatalf("revoked plan/source = %s/%s", account.Plan, account.Source)
	}
}

func TestPGStoreInvalidateRevokesAConcurrentRedemption(t *testing.T) {
	db := integrationDB(t)
	store := NewPGStore(db)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	hash := HashCode(fmt.Sprintf("invalidate-race-%d", stamp))
	codes, err := store.CreateCodes(ctx, "invalidate race", []string{hash})
	if err != nil {
		t.Fatal(err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var codeID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM community_access_codes WHERE code_hash = $1 FOR UPDATE`, hash).Scan(&codeID); err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	invalidated := make(chan error, 1)
	go func() {
		close(started)
		invalidated <- store.Invalidate(ctx, codes[0].ID, "membership ended", time.Now())
	}()
	<-started
	deadline := time.Now().Add(2 * time.Second)
	for {
		var blocked bool
		if err := db.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM pg_stat_activity
				WHERE pid <> pg_backend_pid()
				  AND state = 'active'
				  AND wait_event_type = 'Lock'
				  AND query LIKE '%UPDATE community_access_codes%'
			)
		`).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("invalidation did not block on the redemption row lock")
		}
		time.Sleep(10 * time.Millisecond)
	}

	email := fmt.Sprintf("invalidate-race-%d@example.com", stamp)
	var userID string
	if err := tx.QueryRow(ctx, `INSERT INTO users (email, password_hash) VALUES ($1, 'hash') RETURNING id::text`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, fmt.Sprintf("invalidate-race-session-%d", stamp), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE community_access_codes SET redeemed_user_id = $1, redeemed_at = now() WHERE id = $2`, userID, codeID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-invalidated; err != nil {
		t.Fatal(err)
	}

	var revoked bool
	var reason string
	if err := db.QueryRow(ctx, `SELECT revoked_at IS NOT NULL, revocation_reason FROM community_access_codes WHERE id = $1`, codeID).Scan(&revoked, &reason); err != nil {
		t.Fatal(err)
	}
	if !revoked || reason != "membership ended" {
		t.Fatalf("revoked/reason = %v/%q", revoked, reason)
	}
	billingService := billing.NewService(billing.NewPGStore(db), config.BillingConfig{FreeMaxSavedDocs: 5, ProMaxSavedDocs: 1000})
	account, err := billingService.Account(ctx, auth.User{ID: userID, Email: email})
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanFree || account.Source != billing.SourceDefault {
		t.Fatalf("post-race plan/source = %s/%s", account.Plan, account.Source)
	}
	if err := store.Invalidate(ctx, "00000000-0000-0000-0000-000000000000", "missing", time.Now()); !errors.Is(err, ErrCodeNotFound) {
		t.Fatalf("missing code error = %v", err)
	}
}

func integrationDB(t *testing.T) *database.Pool {
	t.Helper()
	databaseURL := os.Getenv("PASSAGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PASSAGE_TEST_DATABASE_URL is not set")
	}
	db, err := database.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return db
}

func insertIntegrationUser(t *testing.T, db *database.Pool, email string) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `INSERT INTO users (email, password_hash) VALUES ($1, 'hash') RETURNING id::text`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
