package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

const webhookTolerance = 5 * time.Minute

func (a *App) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	if a.billing == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return
	}
	if !a.billingConfig.StripeBillingEnabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Stripe billing is disabled"})
		return
	}
	if !a.billingConfig.StripeConfigured() {
		httpx.WriteInternalError(w, r, "validate Stripe webhook configuration", errors.New("Stripe billing configuration is incomplete"), "Stripe billing is not configured")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpx.LogWarning(r, "read Stripe webhook", err)
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body is too large"})
			return
		}
		httpx.LogWarning(r, "read Stripe webhook", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "webhook body could not be read"})
		return
	}
	if err := verifyStripeSignature(body, r.Header.Get("Stripe-Signature"), a.billingConfig.StripeWebhookSecret, time.Now()); err != nil {
		httpx.LogWarning(r, "verify Stripe webhook signature", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid Stripe signature"})
		return
	}

	var event stripeEvent
	if err := json.Unmarshal(body, &event); err != nil {
		httpx.LogWarning(r, "decode Stripe webhook", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid Stripe event"})
		return
	}
	if err := a.applyStripeEvent(r, event); err != nil {
		httpx.WriteInternalError(
			w,
			r,
			"apply Stripe webhook",
			err,
			"Stripe event could not be applied",
			"stripe_event_id", event.ID,
			"stripe_event_type", event.Type,
		)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"received": true})
}

func (a *App) applyStripeEvent(r *http.Request, event stripeEvent) error {
	switch event.Type {
	case "checkout.session.completed":
		var session stripeCheckoutSession
		if err := json.Unmarshal(event.Data.Object, &session); err != nil {
			return err
		}
		if session.PaymentStatus != "paid" ||
			!validStripeIdentifier(session.Customer, "cus_") ||
			!validStripeIdentifier(session.Subscription, "sub_") {
			return nil
		}
		return a.applyCurrentSubscription(r, session.Customer, session.Subscription)
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		var subscription stripeSubscription
		if err := json.Unmarshal(event.Data.Object, &subscription); err != nil {
			return err
		}
		if !validStripeIdentifier(subscription.Customer, "cus_") ||
			!validStripeIdentifier(subscription.ID, "sub_") {
			return nil
		}
		return a.applyCurrentSubscription(r, subscription.Customer, subscription.ID)
	case "invoice.payment_failed":
		var invoice stripeInvoice
		if err := json.Unmarshal(event.Data.Object, &invoice); err != nil {
			return err
		}
		if !validStripeIdentifier(invoice.Customer, "cus_") ||
			!validStripeIdentifier(invoice.Subscription, "sub_") {
			return nil
		}
		return a.applyCurrentSubscription(r, invoice.Customer, invoice.Subscription)
	}
	return nil
}

func (a *App) applyCurrentSubscription(r *http.Request, customerID string, subscriptionID string) error {
	user, err := a.billing.UserByStripeCustomer(r.Context(), customerID)
	if errors.Is(err, billing.ErrUserNotFound) {
		current, retrieveErr := a.stripe.RetrieveSubscription(r.Context(), subscriptionID)
		if retrieveErr != nil {
			return retrieveErr
		}
		if current.ID != subscriptionID || current.CustomerID != customerID {
			return nil
		}
		user, err = a.resolveStripeUser(r, current.CustomerID, current.Metadata["passage_user_id"])
	}
	if errors.Is(err, billing.ErrUserNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	err = a.billing.RefreshSubscription(r.Context(), user.ID, func(ctx context.Context) (billing.SubscriptionUpdate, error) {
		current, err := a.stripe.RetrieveSubscription(ctx, subscriptionID)
		if err != nil {
			return billing.SubscriptionUpdate{}, err
		}
		if current.ID != subscriptionID ||
			current.CustomerID != customerID ||
			(current.Metadata["passage_user_id"] != "" && current.Metadata["passage_user_id"] != user.ID) {
			return billing.SubscriptionUpdate{}, billing.ErrUserNotFound
		}
		return billing.SubscriptionUpdate{
			CustomerID:            current.CustomerID,
			SubscriptionID:        current.ID,
			SubscriptionCreatedAt: current.CreatedAt,
			Status:                current.Status,
			PriceID:               current.PriceID,
			CurrentPeriodEnd:      current.CurrentPeriodEnd,
			CancelAtPeriodEnd:     &current.CancelAtPeriodEnd,
			EventCreated:          &current.RetrievedAt,
		}, nil
	})
	if errors.Is(err, billing.ErrUserNotFound) {
		return nil
	}
	return err
}

func (a *App) resolveStripeUser(r *http.Request, customerID string, metadataUserID string) (auth.User, error) {
	user, err := a.billing.UserByStripeCustomer(r.Context(), customerID)
	if err == nil {
		if metadataUserID != "" && metadataUserID != user.ID {
			return auth.User{}, billing.ErrUserNotFound
		}
		return user, nil
	}
	if !errors.Is(err, billing.ErrUserNotFound) {
		return auth.User{}, err
	}
	if metadataUserID == "" {
		return auth.User{}, billing.ErrUserNotFound
	}
	return a.billing.UserByID(r.Context(), metadataUserID)
}

func validStripeIdentifier(value string, prefix string) bool {
	if !strings.HasPrefix(value, prefix) || len(value) == len(prefix) {
		return false
	}
	for _, char := range value[len(prefix):] {
		if (char < 'a' || char > 'z') &&
			(char < 'A' || char > 'Z') &&
			(char < '0' || char > '9') {
			return false
		}
	}
	return true
}

func verifyStripeSignature(payload []byte, header string, secret string, now time.Time) error {
	var timestamp string
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signatures = append(signatures, value)
		}
	}
	if timestamp == "" || len(signatures) == 0 {
		return errors.New("missing signature")
	}
	unix, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return err
	}
	signedAt := time.Unix(unix, 0)
	if now.Sub(signedAt) > webhookTolerance || signedAt.Sub(now) > webhookTolerance {
		return errors.New("signature timestamp outside tolerance")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, sig := range signatures {
		if hmac.Equal([]byte(expected), []byte(sig)) {
			return nil
		}
	}
	return errors.New("signature mismatch")
}

type stripeEvent struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Created int64  `json:"created"`
	Data    struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

type stripeCheckoutSession struct {
	Customer          string            `json:"customer"`
	Subscription      string            `json:"subscription"`
	ClientReferenceID string            `json:"client_reference_id"`
	PaymentStatus     string            `json:"payment_status"`
	Metadata          map[string]string `json:"metadata"`
}

type stripeSubscription struct {
	ID       string `json:"id"`
	Customer string `json:"customer"`
}

type stripeInvoice struct {
	Customer     string `json:"customer"`
	Subscription string `json:"subscription"`
}
