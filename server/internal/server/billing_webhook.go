package server

import (
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

	"github.com/owainlewis/passage.md/server/internal/billing"
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Stripe billing is not configured"})
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body is too large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "webhook body could not be read"})
		return
	}
	if err := verifyStripeSignature(body, r.Header.Get("Stripe-Signature"), a.billingConfig.StripeWebhookSecret, time.Now()); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid Stripe signature"})
		return
	}

	var event stripeEvent
	if err := json.Unmarshal(body, &event); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid Stripe event"})
		return
	}
	if err := a.applyStripeEvent(r, event); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Stripe event could not be applied"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"received": true})
}

func (a *App) applyStripeEvent(r *http.Request, event stripeEvent) error {
	eventCreated := time.Unix(event.Created, 0).UTC()
	switch event.Type {
	case "checkout.session.completed":
		var session stripeCheckoutSession
		if err := json.Unmarshal(event.Data.Object, &session); err != nil {
			return err
		}
		userID := session.ClientReferenceID
		if userID == "" {
			userID = session.Metadata["passage_user_id"]
		}
		if userID == "" || session.Customer == "" {
			return nil
		}
		if err := a.billing.SetStripeCustomer(r.Context(), userID, session.Customer); err != nil {
			return err
		}
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		var subscription stripeSubscription
		if err := json.Unmarshal(event.Data.Object, &subscription); err != nil {
			return err
		}
		return a.applySubscriptionEvent(r, subscription, eventCreated)
	case "invoice.payment_failed":
		var invoice stripeInvoice
		if err := json.Unmarshal(event.Data.Object, &invoice); err != nil {
			return err
		}
		if invoice.Customer == "" || invoice.Subscription == "" {
			return nil
		}
		user, err := a.billing.UserByStripeCustomer(r.Context(), invoice.Customer)
		if errors.Is(err, billing.ErrUserNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		return a.billing.UpdateSubscription(r.Context(), user.ID, billing.SubscriptionUpdate{
			CustomerID:     invoice.Customer,
			SubscriptionID: invoice.Subscription,
			Status:         "past_due",
			EventCreated:   &eventCreated,
		})
	}
	return nil
}

func (a *App) applySubscriptionEvent(r *http.Request, subscription stripeSubscription, eventCreated time.Time) error {
	if subscription.Customer == "" || subscription.ID == "" {
		return nil
	}
	user, err := a.billing.UserByStripeCustomer(r.Context(), subscription.Customer)
	if errors.Is(err, billing.ErrUserNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	var periodEnd *time.Time
	if currentPeriodEnd := subscription.CurrentPeriodEndValue(); currentPeriodEnd > 0 {
		value := time.Unix(currentPeriodEnd, 0).UTC()
		periodEnd = &value
	}
	cancelAtPeriodEnd := subscription.ScheduledForCancellation()
	return a.billing.UpdateSubscription(r.Context(), user.ID, billing.SubscriptionUpdate{
		CustomerID:        subscription.Customer,
		SubscriptionID:    subscription.ID,
		Status:            subscription.Status,
		PriceID:           subscription.PriceID(),
		CurrentPeriodEnd:  periodEnd,
		CancelAtPeriodEnd: &cancelAtPeriodEnd,
		EventCreated:      &eventCreated,
	})
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
	ID                string `json:"id"`
	Customer          string `json:"customer"`
	Status            string `json:"status"`
	CurrentPeriodEnd  int64  `json:"current_period_end"`
	CancelAtPeriodEnd bool   `json:"cancel_at_period_end"`
	CancelAt          int64  `json:"cancel_at"`
	EndedAt           int64  `json:"ended_at"`
	Items             struct {
		Data []struct {
			CurrentPeriodEnd int64 `json:"current_period_end"`
			Price            struct {
				ID string `json:"id"`
			} `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

func (s stripeSubscription) PriceID() string {
	if len(s.Items.Data) == 0 {
		return ""
	}
	return s.Items.Data[0].Price.ID
}

func (s stripeSubscription) CurrentPeriodEndValue() int64 {
	if s.CurrentPeriodEnd > 0 {
		return s.CurrentPeriodEnd
	}
	if len(s.Items.Data) > 0 && s.Items.Data[0].CurrentPeriodEnd > 0 {
		return s.Items.Data[0].CurrentPeriodEnd
	}
	if s.CancelAt > 0 {
		return s.CancelAt
	}
	return 0
}

func (s stripeSubscription) ScheduledForCancellation() bool {
	return s.CancelAtPeriodEnd || (s.CancelAt > 0 && s.EndedAt == 0 && s.Status != "canceled")
}

type stripeInvoice struct {
	Customer     string `json:"customer"`
	Subscription string `json:"subscription"`
}
