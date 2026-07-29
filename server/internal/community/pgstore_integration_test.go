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
	"github.com/owainlewis/passage.md/server/internal/policy"
)

func TestPGStoreReferralIsReusableAndAtomic(t *testing.T) {
	db := integrationDB(t)
	store := NewPGStore(db)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	slug := fmt.Sprintf("reusable-%d", stamp)
	hash := HashCode(fmt.Sprintf("code-%d", stamp))
	referral, err := store.CreateReferral(ctx, slug, "Reusable", hash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateReferral(ctx, slug, "Duplicate", HashCode("different")); !errors.Is(err, ErrReferralExists) {
		t.Fatalf("duplicate referral error = %v", err)
	}

	t.Run("session failure rolls back user and grant", func(t *testing.T) {
		existingUser := insertIntegrationUser(t, db, fmt.Sprintf("existing-%d@example.com", stamp))
		collision := auth.PreparedSession{TokenHash: fmt.Sprintf("collision-%d", stamp), ExpiresAt: time.Now().Add(time.Hour)}
		if _, err := db.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, existingUser, collision.TokenHash, collision.ExpiresAt); err != nil {
			t.Fatal(err)
		}
		email := fmt.Sprintf("rollback-%d@example.com", stamp)
		if _, err := store.Redeem(ctx, slug, hash, email, "hash", policy.CurrentVersion, collision, time.Now()); err == nil {
			t.Fatal("redeem succeeded")
		}
		var users, grants int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = $1`, email).Scan(&users); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(ctx, `SELECT count(*) FROM community_grants WHERE referral_id = $1`, referral.ID).Scan(&grants); err != nil {
			t.Fatal(err)
		}
		if users != 0 || grants != 0 {
			t.Fatalf("users/grants = %d/%d", users, grants)
		}
		if _, err := store.FindActiveReferral(ctx, slug, hash); err != nil {
			t.Fatalf("referral no longer active: %v", err)
		}
	})

	t.Run("concurrent distinct members all receive grants", func(t *testing.T) {
		var successes atomic.Int32
		var wg sync.WaitGroup
		for i := range 3 {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				_, err := store.Redeem(ctx, slug, hash, fmt.Sprintf("member-%d-%d@example.com", stamp, i), "hash", policy.CurrentVersion, auth.PreparedSession{TokenHash: fmt.Sprintf("member-session-%d-%d", stamp, i), ExpiresAt: time.Now().Add(time.Hour)}, time.Now())
				if err != nil {
					t.Errorf("redeem %d: %v", i, err)
					return
				}
				successes.Add(1)
			}(i)
		}
		wg.Wait()
		if successes.Load() != 3 {
			t.Fatalf("successes = %d", successes.Load())
		}
		var grants int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM community_grants WHERE referral_id = $1`, referral.ID).Scan(&grants); err != nil {
			t.Fatal(err)
		}
		if grants != 3 {
			t.Fatalf("grants = %d", grants)
		}
		if _, err := store.FindActiveReferral(ctx, slug, hash); err != nil {
			t.Fatalf("reusable referral inactive: %v", err)
		}
	})

	t.Run("same email cannot create duplicate accounts", func(t *testing.T) {
		email := fmt.Sprintf("duplicate-%d@example.com", stamp)
		var successes, conflicts atomic.Int32
		var wg sync.WaitGroup
		for i := range 2 {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				_, err := store.Redeem(ctx, slug, hash, email, "hash", policy.CurrentVersion, auth.PreparedSession{TokenHash: fmt.Sprintf("duplicate-session-%d-%d", stamp, i), ExpiresAt: time.Now().Add(time.Hour)}, time.Now())
				if err == nil {
					successes.Add(1)
				} else if errors.Is(err, ErrEmailTaken) {
					conflicts.Add(1)
				} else {
					t.Errorf("redeem %d: %v", i, err)
				}
			}(i)
		}
		wg.Wait()
		if successes.Load() != 1 || conflicts.Load() != 1 {
			t.Fatalf("success/conflict = %d/%d", successes.Load(), conflicts.Load())
		}
	})
}

func TestPGStoreReferralLifecycleAndCommunityEntitlement(t *testing.T) {
	db := integrationDB(t)
	store := NewPGStore(db)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	slug := fmt.Sprintf("lifecycle-%d", stamp)
	oldHash := HashCode(fmt.Sprintf("old-%d", stamp))
	referral, err := store.CreateReferral(ctx, slug, "Lifecycle", oldHash)
	if err != nil {
		t.Fatal(err)
	}
	email := fmt.Sprintf("member-%d@example.com", stamp)
	acceptedAt := time.Now().UTC().Truncate(time.Microsecond)
	user, err := store.Redeem(ctx, slug, oldHash, email, "hash", policy.CurrentVersion, auth.PreparedSession{TokenHash: fmt.Sprintf("lifecycle-session-%d", stamp), ExpiresAt: time.Now().Add(time.Hour)}, acceptedAt)
	if err != nil {
		t.Fatal(err)
	}
	var storedPolicyVersion string
	var storedAcceptedAt time.Time
	if err := db.QueryRow(ctx, `SELECT policy_version, policy_accepted_at FROM users WHERE id = $1`, user.ID).Scan(&storedPolicyVersion, &storedAcceptedAt); err != nil {
		t.Fatal(err)
	}
	if storedPolicyVersion != policy.CurrentVersion || !storedAcceptedAt.Equal(acceptedAt) {
		t.Fatalf("stored policy acceptance = %q/%s, want %q/%s", storedPolicyVersion, storedAcceptedAt, policy.CurrentVersion, acceptedAt)
	}

	var billingRows int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM billing_accounts WHERE user_id = $1`, user.ID).Scan(&billingRows); err != nil {
		t.Fatal(err)
	}
	if billingRows != 0 {
		t.Fatalf("billing rows = %d", billingRows)
	}
	billingService := billing.NewService(billing.NewPGStore(db), config.BillingConfig{FreeMaxSavedDocs: 5, ProMaxSavedDocs: 1000})
	account, err := billingService.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro || account.Source != billing.SourceCommunity || account.Subscription.StripeCustomerID != "" {
		t.Fatalf("account = %#v", account)
	}

	newHash := HashCode(fmt.Sprintf("new-%d", stamp))
	if _, err := store.RotateReferral(ctx, referral.ID, newHash, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindActiveReferral(ctx, slug, oldHash); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("old code error = %v", err)
	}
	if _, err := store.FindActiveReferral(ctx, slug, newHash); err != nil {
		t.Fatalf("new code error = %v", err)
	}
	if err := store.DisableReferral(ctx, referral.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindActiveReferral(ctx, slug, newHash); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("disabled error = %v", err)
	}

	account, err = billingService.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanPro {
		t.Fatalf("rotation/disable revoked existing member: %#v", account)
	}
	if err := store.RevokeGrant(ctx, email, "membership ended", time.Now()); err != nil {
		t.Fatal(err)
	}
	account, err = billingService.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if account.Plan != billing.PlanFree || account.Source != billing.SourceDefault {
		t.Fatalf("revoked account = %#v", account)
	}
	if err := store.RevokeGrant(ctx, email, "again", time.Now()); !errors.Is(err, ErrGrantNotFound) {
		t.Fatalf("second revoke error = %v", err)
	}
}

func TestPGStoreDisablesReferralBySlug(t *testing.T) {
	db := integrationDB(t)
	store := NewPGStore(db)
	ctx := context.Background()
	stamp := time.Now().UnixNano()
	slug := fmt.Sprintf("disable-by-slug-%d", stamp)
	codeHash := HashCode(fmt.Sprintf("disable-code-%d", stamp))
	if _, err := store.CreateReferral(ctx, slug, "Disable by slug", codeHash); err != nil {
		t.Fatal(err)
	}

	if err := store.DisableReferralBySlug(ctx, slug, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindActiveReferral(ctx, slug, codeHash); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("disabled referral lookup error = %v", err)
	}
	if err := store.DisableReferralBySlug(ctx, slug, time.Now()); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("second disable error = %v", err)
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
