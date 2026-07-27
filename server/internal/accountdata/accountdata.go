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

type DeleteOptions struct {
	StripeVerifiedNoActiveSubscription bool
}

type Account struct {
	ID                       string     `json:"id"`
	Email                    string     `json:"email"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
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
	body       string
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
	tx, err := db.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	account, err := loadAccount(ctx, tx, email, "")
	if err != nil {
		return err
	}
	documents, err := loadDocuments(ctx, tx, account.ID)
	if err != nil {
		return err
	}
	tokens, err := loadTokens(ctx, tx, account.ID)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
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
	if err := writeJSONFile(writer, "documents.json", documents); err != nil {
		return err
	}
	if err := writeJSONFile(writer, "api-tokens.json", tokens); err != nil {
		return err
	}
	for _, document := range documents {
		entry, err := writer.Create(document.Path)
		if err != nil {
			return err
		}
		if _, err := entry.Write([]byte(document.body)); err != nil {
			return err
		}
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

func Delete(ctx context.Context, db *database.Pool, email string, options DeleteOptions) error {
	email = normalizeEmail(email)
	if email == "" {
		return ErrAccountNotFound
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
	return tx.Commit(ctx)
}

func loadAccount(ctx context.Context, tx pgx.Tx, email string, lock string) (Account, error) {
	var account Account
	query := `
		SELECT users.id::text,
		       users.email,
		       users.created_at,
		       users.updated_at,
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

func loadDocuments(ctx context.Context, tx pgx.Tx, userID string) ([]Document, error) {
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
		if err := rows.Scan(
			&document.ID,
			&document.PublicID,
			&document.Title,
			&document.body,
			&document.SharedAt,
			&document.CreatedAt,
			&document.UpdatedAt,
			&document.ArchivedAt,
		); err != nil {
			return nil, err
		}
		document.Path = "documents/" + document.ID + ".md"
		documents = append(documents, document)
	}
	return documents, rows.Err()
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
