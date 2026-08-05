package accountdata

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/passage.md/server/internal/database"
)

var ErrAccountNotFound = errors.New("account not found")
var ErrActiveSubscription = errors.New("Stripe state must be terminal or explicitly verified as having no active subscription before deletion")
var ErrStripeNeutralizerRequired = errors.New("Stripe checkout neutralization is required before deleting an account with a Stripe customer")
var ErrPriorAccountStripeCleanupPending = errors.New("Stripe cleanup for a previously deleted account must be completed separately")
var ErrStripeCleanupNotPending = errors.New("no matching Stripe cleanup job is pending")

type StripeCustomerNeutralizer interface {
	NeutralizeUnsubscribedCustomer(context.Context, string) error
}

type DeleteOptions struct {
	StripeVerifiedNoActiveSubscription bool
	Stripe                             StripeCustomerNeutralizer
}

type Account struct {
	ID                       string     `json:"id"`
	Email                    string     `json:"email"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
	PolicyVersion            *string    `json:"policyVersion,omitempty"`
	PolicyAcceptedAt         *time.Time `json:"policyAcceptedAt,omitempty"`
	ManualPlan               *string    `json:"manualPlan,omitempty"`
	MaxSavedDocs             *int       `json:"maxSavedDocs,omitempty"`
	CommunityAccess          bool       `json:"communityAccess"`
	StripeCustomerID         string     `json:"stripeCustomerId,omitempty"`
	StripeSubscriptionID     string     `json:"stripeSubscriptionId,omitempty"`
	StripeSubscriptionStatus string     `json:"stripeSubscriptionStatus,omitempty"`
	StripePriceID            string     `json:"stripePriceId,omitempty"`
	StripeCurrentPeriodEnd   *time.Time `json:"stripeCurrentPeriodEnd,omitempty"`
	StripeCancelAtPeriodEnd  bool       `json:"stripeCancelAtPeriodEnd"`
}

type Document struct {
	ID         string     `json:"id"`
	PublicID   string     `json:"publicId"`
	Title      string     `json:"title"`
	Path       string     `json:"path"`
	SharedAt   *time.Time `json:"sharedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

type Template struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Path        string    `json:"path"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Token struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type accountExport struct {
	Version    int       `json:"version"`
	ExportedAt time.Time `json:"exportedAt"`
	Account    Account   `json:"account"`
}

func Export(ctx context.Context, db *database.Pool, email string, outputPath string, now time.Time) error {
	email = normalizeEmail(email)
	if email == "" {
		return ErrAccountNotFound
	}
	tx, err := beginExportTransaction(ctx, db)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	account, err := loadAccount(ctx, tx, email, "")
	if err != nil {
		return err
	}
	tokens, err := loadTokens(ctx, tx, account.ID)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		_ = file.Close()
		if !complete {
			_ = os.Remove(outputPath)
		}
	}()

	writer := zip.NewWriter(file)
	if err := writeJSONFile(writer, "account.json", accountExport{Version: 1, ExportedAt: now.UTC(), Account: account}); err != nil {
		return err
	}
	documents, err := writeDocuments(ctx, tx, writer, account.ID)
	if err != nil {
		return err
	}
	if err := writeJSONFile(writer, "documents.json", documents); err != nil {
		return err
	}
	templates, err := writeTemplates(ctx, tx, writer, account.ID)
	if err != nil {
		return err
	}
	if err := writeJSONFile(writer, "templates.json", templates); err != nil {
		return err
	}
	if err := writeJSONFile(writer, "api-tokens.json", tokens); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	complete = true
	return nil
}

func beginExportTransaction(ctx context.Context, db *database.Pool) (pgx.Tx, error) {
	return db.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
}

func Delete(ctx context.Context, db *database.Pool, email string, options DeleteOptions) error {
	email = normalizeEmail(email)
	if email == "" {
		return ErrAccountNotFound
	}
	jobs := pgStripeCleanupJobs{db: db}
	if customerID, err := jobs.customerForEmail(ctx, email); err != nil {
		return err
	} else if customerID != "" {
		return fmt.Errorf("%w: run passage account cleanup-stripe %s", ErrPriorAccountStripeCleanupPending, customerID)
	}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	account, err := loadAccount(ctx, tx, email, "FOR UPDATE OF users")
	if err != nil {
		return err
	}
	if err := lockBillingState(ctx, tx, &account); err != nil {
		return err
	}
	hasStripeSubscription := account.StripeCustomerID != "" ||
		account.StripeSubscriptionID != "" ||
		account.StripeSubscriptionStatus != ""
	verifiedCustomerWithoutSubscription := options.StripeVerifiedNoActiveSubscription &&
		account.StripeCustomerID != "" &&
		account.StripeSubscriptionID == "" &&
		account.StripeSubscriptionStatus == ""
	if hasStripeSubscription &&
		!terminalStripeStatus(account.StripeSubscriptionStatus) &&
		!verifiedCustomerWithoutSubscription {
		return ErrActiveSubscription
	}
	if account.StripeCustomerID != "" {
		if options.Stripe == nil {
			return ErrStripeNeutralizerRequired
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO stripe_customer_cleanup_jobs (account_email, stripe_customer_id)
			VALUES ($1, $2)
			ON CONFLICT (account_email) DO UPDATE
			SET stripe_customer_id = EXCLUDED.stripe_customer_id,
			    attempts = 0,
			    last_error = NULL,
			    updated_at = now()
		`, email, account.StripeCustomerID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM password_reset_requests WHERE lower(email) = $1`, email); err != nil {
		return err
	}
	emailHash := sha256.Sum256([]byte(email))
	if _, err := tx.Exec(ctx, `
		DELETE FROM password_reset_rate_limits
		WHERE dimension = 'email' AND key_hash = $1
	`, hex.EncodeToString(emailHash[:])); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM password_reset_confirmation_rate_limits
		WHERE dimension = 'token'
		  AND key_hash IN (
		    SELECT token_hash FROM password_reset_tokens WHERE user_id = $1
		  )
	`, account.ID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, account.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrAccountNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if account.StripeCustomerID == "" {
		return nil
	}
	return CleanupStripeCustomer(ctx, db, account.StripeCustomerID, options.Stripe)
}

type stripeCleanupJobs interface {
	customerForEmail(context.Context, string) (string, error)
	exists(context.Context, string) (bool, error)
	recordFailure(context.Context, string, error) (bool, error)
	delete(context.Context, string) error
}

type pgStripeCleanupJobs struct {
	db *database.Pool
}

func (j pgStripeCleanupJobs) customerForEmail(ctx context.Context, email string) (string, error) {
	var customerID string
	err := j.db.QueryRow(ctx, `
		SELECT stripe_customer_id
		FROM stripe_customer_cleanup_jobs
		WHERE account_email = $1
	`, email).Scan(&customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return customerID, err
}

func (j pgStripeCleanupJobs) exists(ctx context.Context, customerID string) (bool, error) {
	var exists bool
	err := j.db.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1
		  FROM stripe_customer_cleanup_jobs
		  WHERE stripe_customer_id = $1
		)
	`, customerID).Scan(&exists)
	return exists, err
}

func (j pgStripeCleanupJobs) recordFailure(ctx context.Context, customerID string, cleanupErr error) (bool, error) {
	tag, err := j.db.Exec(ctx, `
		UPDATE stripe_customer_cleanup_jobs
		SET attempts = attempts + 1,
		    last_error = $2,
		    updated_at = now()
		WHERE stripe_customer_id = $1
	`, customerID, cleanupErr.Error())
	return tag.RowsAffected() == 1, err
}

func (j pgStripeCleanupJobs) delete(ctx context.Context, customerID string) error {
	_, err := j.db.Exec(ctx, `
		DELETE FROM stripe_customer_cleanup_jobs
		WHERE stripe_customer_id = $1
	`, customerID)
	return err
}

func CleanupStripeCustomer(ctx context.Context, db *database.Pool, customerID string, stripe StripeCustomerNeutralizer) error {
	if stripe == nil {
		return ErrStripeNeutralizerRequired
	}
	customerID = strings.TrimSpace(customerID)
	if customerID == "" {
		return errors.New("Stripe customer ID is required")
	}
	return cleanupStripeCustomer(ctx, pgStripeCleanupJobs{db: db}, customerID, stripe)
}

func cleanupStripeCustomer(ctx context.Context, jobs stripeCleanupJobs, customerID string, stripe StripeCustomerNeutralizer) error {
	exists, err := jobs.exists(ctx, customerID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrStripeCleanupNotPending
	}
	if err := stripe.NeutralizeUnsubscribedCustomer(ctx, customerID); err != nil {
		recorded, recordErr := jobs.recordFailure(ctx, customerID, err)
		if recordErr != nil {
			return errors.Join(fmt.Errorf("Stripe cleanup is pending: %w", err), fmt.Errorf("record cleanup failure: %w", recordErr))
		}
		if !recorded {
			reconcileCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			stillPending, lookupErr := jobs.exists(reconcileCtx, customerID)
			if lookupErr != nil {
				return errors.Join(fmt.Errorf("Stripe cleanup is pending: %w", err), fmt.Errorf("reconcile cleanup job: %w", lookupErr))
			}
			if !stillPending {
				return nil
			}
		}
		return fmt.Errorf("Passage account deleted; Stripe cleanup is pending. Run passage account cleanup-stripe %s: %w", customerID, err)
	}
	if err := jobs.delete(ctx, customerID); err != nil {
		reconcileCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		stillPending, lookupErr := jobs.exists(reconcileCtx, customerID)
		if lookupErr != nil {
			return errors.Join(err, fmt.Errorf("reconcile cleanup job deletion: %w", lookupErr))
		}
		if stillPending {
			return err
		}
	}
	return nil
}

func lockBillingState(ctx context.Context, tx pgx.Tx, account *Account) error {
	err := tx.QueryRow(ctx, `
		SELECT manual_plan,
		       max_saved_docs,
		       COALESCE(stripe_customer_id, ''),
		       COALESCE(stripe_subscription_id, ''),
		       COALESCE(stripe_subscription_status, ''),
		       COALESCE(stripe_price_id, ''),
		       stripe_current_period_end,
		       COALESCE(stripe_cancel_at_period_end, false)
		FROM billing_accounts
		WHERE user_id = $1
		FOR UPDATE
	`, account.ID).Scan(
		&account.ManualPlan,
		&account.MaxSavedDocs,
		&account.StripeCustomerID,
		&account.StripeSubscriptionID,
		&account.StripeSubscriptionStatus,
		&account.StripePriceID,
		&account.StripeCurrentPeriodEnd,
		&account.StripeCancelAtPeriodEnd,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		account.ManualPlan = nil
		account.MaxSavedDocs = nil
		account.StripeCustomerID = ""
		account.StripeSubscriptionID = ""
		account.StripeSubscriptionStatus = ""
		account.StripePriceID = ""
		account.StripeCurrentPeriodEnd = nil
		account.StripeCancelAtPeriodEnd = false
		return nil
	}
	return err
}

func loadAccount(ctx context.Context, tx pgx.Tx, email string, lock string) (Account, error) {
	var account Account
	query := `
		SELECT users.id::text,
		       users.email,
		       users.created_at,
		       users.updated_at,
		       users.policy_version,
		       users.policy_accepted_at,
		       billing_accounts.manual_plan,
		       billing_accounts.max_saved_docs,
		       EXISTS (
		         SELECT 1 FROM community_grants
		         WHERE user_id = users.id AND revoked_at IS NULL
		       ),
		       COALESCE(billing_accounts.stripe_customer_id, ''),
		       COALESCE(billing_accounts.stripe_subscription_id, ''),
		       COALESCE(billing_accounts.stripe_subscription_status, ''),
		       COALESCE(billing_accounts.stripe_price_id, ''),
		       billing_accounts.stripe_current_period_end,
		       COALESCE(billing_accounts.stripe_cancel_at_period_end, false)
		FROM users
		LEFT JOIN billing_accounts ON billing_accounts.user_id = users.id
		WHERE users.email = $1
		` + lock
	err := tx.QueryRow(ctx, query, email).Scan(
		&account.ID,
		&account.Email,
		&account.CreatedAt,
		&account.UpdatedAt,
		&account.PolicyVersion,
		&account.PolicyAcceptedAt,
		&account.ManualPlan,
		&account.MaxSavedDocs,
		&account.CommunityAccess,
		&account.StripeCustomerID,
		&account.StripeSubscriptionID,
		&account.StripeSubscriptionStatus,
		&account.StripePriceID,
		&account.StripeCurrentPeriodEnd,
		&account.StripeCancelAtPeriodEnd,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrAccountNotFound
	}
	return account, err
}

func writeDocuments(ctx context.Context, tx pgx.Tx, writer *zip.Writer, userID string) ([]Document, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, public_id, title, body, shared_at, created_at, updated_at, archived_at
		FROM documents
		WHERE owner_user_id = $1
		ORDER BY created_at, id
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	documents := []Document{}
	for rows.Next() {
		var document Document
		var body string
		if err := rows.Scan(
			&document.ID,
			&document.PublicID,
			&document.Title,
			&body,
			&document.SharedAt,
			&document.CreatedAt,
			&document.UpdatedAt,
			&document.ArchivedAt,
		); err != nil {
			return nil, err
		}
		document.Path = "documents/" + document.ID + ".md"
		documents = append(documents, document)
		entry, err := writer.Create(document.Path)
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			return nil, err
		}
	}
	return documents, rows.Err()
}

func writeTemplates(ctx context.Context, tx pgx.Tx, writer *zip.Writer, userID string) ([]Template, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, title, description, body, created_at, updated_at
		FROM templates
		WHERE owner_user_id = $1
		ORDER BY created_at, id
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	templates := []Template{}
	for rows.Next() {
		var template Template
		var body string
		if err := rows.Scan(
			&template.ID,
			&template.Title,
			&template.Description,
			&body,
			&template.CreatedAt,
			&template.UpdatedAt,
		); err != nil {
			return nil, err
		}
		template.Path = "templates/" + template.ID + ".md"
		templates = append(templates, template)
		entry, err := writer.Create(template.Path)
		if err != nil {
			return nil, err
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			return nil, err
		}
	}
	return templates, rows.Err()
}

func loadTokens(ctx context.Context, tx pgx.Tx, userID string) ([]Token, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, name, last_used_at, revoked_at, created_at
		FROM api_tokens
		WHERE user_id = $1
		ORDER BY created_at, id
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := []Token{}
	for rows.Next() {
		var token Token
		if err := rows.Scan(&token.ID, &token.Name, &token.LastUsedAt, &token.RevokedAt, &token.CreatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

func writeJSONFile(writer *zip.Writer, name string, value any) error {
	entry, err := writer.Create(name)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(entry)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return fmt.Errorf("encode %s: %w", name, err)
	}
	return nil
}

func terminalStripeStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "canceled", "incomplete_expired":
		return true
	default:
		return false
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
