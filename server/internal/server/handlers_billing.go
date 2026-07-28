package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

func (a *App) createCheckoutSession(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	if !validateSameOriginMutation(w, r) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requireStripeBilling(w, r) {
			return
		}
		account, err := a.billing.Account(r.Context(), user)
		if err != nil {
			httpx.WriteInternalError(w, r, "load checkout account", err, "account could not be loaded")
			return
		}
		customerID := account.Subscription.StripeCustomerID
		if customerID == "" {
			candidateCustomerID, createErr := a.stripe.CreateCustomer(r.Context(), billing.CustomerParams{
				Email:  user.Email,
				UserID: user.ID,
			})
			if createErr != nil {
				httpx.WriteInternalError(w, r, "create Stripe customer", createErr, "Stripe customer could not be created")
				return
			}
			customerID, err = a.billing.SetStripeCustomer(r.Context(), user.ID, candidateCustomerID)
			if err != nil {
				err = a.reconcileStripeCustomerWrite(r.Context(), user, candidateCustomerID, err)
				httpx.WriteInternalError(w, r, "save Stripe customer", err, "billing customer could not be saved")
				return
			}
			if customerID != candidateCustomerID {
				if err := a.cleanupStripeCustomer(r.Context(), candidateCustomerID); err != nil {
					httpx.WriteInternalError(w, r, "delete duplicate Stripe customer", err, "Stripe customer could not be reconciled")
					return
				}
			}
			if customerID == "" {
				httpx.WriteInternalError(w, r, "save Stripe customer", errors.New("stored Stripe customer is empty"), "billing customer could not be saved")
				return
			}
		}
		if err := a.stripe.ConfigureCustomer(r.Context(), customerID, billing.CustomerParams{
			Email:  user.Email,
			UserID: user.ID,
		}); err != nil {
			httpx.WriteInternalError(w, r, "configure Stripe customer", err, "Stripe customer could not be configured")
			return
		}
		sessionURL, err := a.stripe.CreateCheckoutSession(r.Context(), billing.CheckoutParams{
			CustomerID:     customerID,
			UserID:         user.ID,
			MonthlyPriceID: a.billingConfig.StripeMonthlyPrice,
			SuccessURL:     absoluteAppURL(a.billingConfig.AppBaseURL, "/account?billing=success"),
			CancelURL:      absoluteAppURL(a.billingConfig.AppBaseURL, "/account?billing=cancel"),
		})
		if err != nil {
			httpx.WriteInternalError(w, r, "create Stripe Checkout session", err, "Stripe Checkout could not be created")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": sessionURL})
	})(w, r)
}

func (a *App) cleanupStripeCustomer(ctx context.Context, customerID string) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), stripeCustomerCleanupTimeout)
	defer cancel()
	return a.stripe.NeutralizeUnsubscribedCustomer(cleanupCtx, customerID)
}

func (a *App) reconcileStripeCustomerWrite(ctx context.Context, user auth.User, candidateCustomerID string, writeErr error) error {
	reconcileCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), stripeCustomerCleanupTimeout)
	defer cancel()

	if _, err := a.billing.UserByID(reconcileCtx, user.ID); err != nil {
		if !errors.Is(err, billing.ErrUserNotFound) {
			return errors.Join(writeErr, fmt.Errorf("reconcile Stripe customer owner: %w", err))
		}
	} else {
		account, err := a.billing.Account(reconcileCtx, user)
		if err != nil {
			return errors.Join(writeErr, fmt.Errorf("reconcile stored Stripe customer: %w", err))
		}
		if account.Subscription.StripeCustomerID == candidateCustomerID {
			return writeErr
		}
		if account.Subscription.StripeCustomerID == "" {
			return fmt.Errorf("preserve Stripe customer candidate for idempotent retry: %w", writeErr)
		}
	}
	if err := a.stripe.NeutralizeUnsubscribedCustomer(reconcileCtx, candidateCustomerID); err != nil {
		return errors.Join(writeErr, fmt.Errorf("delete unlinked Stripe customer: %w", err))
	}
	return writeErr
}

func (a *App) createPortalSession(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	if !validateSameOriginMutation(w, r) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requireStripeBilling(w, r) {
			return
		}
		account, err := a.billing.Account(r.Context(), user)
		if err != nil {
			httpx.WriteInternalError(w, r, "load billing portal account", err, "account could not be loaded")
			return
		}
		if account.Subscription.StripeCustomerID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "billing customer is not linked"})
			return
		}
		sessionURL, err := a.stripe.CreatePortalSession(r.Context(), billing.PortalParams{
			CustomerID: account.Subscription.StripeCustomerID,
			ReturnURL:  absoluteAppURL(a.billingConfig.AppBaseURL, "/account"),
		})
		if err != nil {
			httpx.WriteInternalError(w, r, "create Stripe customer portal", err, "Stripe customer portal could not be created")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": sessionURL})
	})(w, r)
}

func (a *App) requireBillingService(w http.ResponseWriter) bool {
	if a.auth == nil || a.billing == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) requireStripeBilling(w http.ResponseWriter, r *http.Request) bool {
	if !a.billingConfig.StripeBillingEnabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Stripe billing is disabled"})
		return false
	}
	if !a.billingConfig.StripeConfigured() {
		httpx.WriteInternalError(w, r, "validate Stripe configuration", errors.New("Stripe billing configuration is incomplete"), "Stripe billing is not configured")
		return false
	}
	return true
}

func (a *App) requirePro(w http.ResponseWriter, r *http.Request, user auth.User) bool {
	if a.billing == nil {
		return true
	}
	if _, err := a.billing.EnsurePro(r.Context(), user); err != nil {
		if errors.Is(err, billing.ErrPaidRequired) {
			writePaymentRequired(w, "Passage Pro is required")
			return false
		}
		httpx.WriteInternalError(w, r, "check Pro entitlement", err, "account could not be loaded")
		return false
	}
	return true
}

func absoluteAppURL(base string, path string) string {
	base = strings.TrimRight(base, "/")
	if base == "" {
		base = "http://localhost:8080"
	}
	return base + path
}
