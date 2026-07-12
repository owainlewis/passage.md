package server

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/url"
	"strings"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/documents"
)

type Options struct {
	SessionSecret string
	CookieSecure  bool
	Billing       config.BillingConfig
}

type App struct {
	static        fs.FS
	db            *database.Pool
	auth          *auth.Service
	docs          *documents.Handler
	billing       *billing.Service
	stripe        *billing.StripeClient
	billingConfig config.BillingConfig
}

func NewApp(static fs.FS, db *database.Pool, opts ...Options) *App {
	var options Options
	if len(opts) > 0 {
		options = opts[0]
	}
	if options.SessionSecret == "" {
		options.SessionSecret = "dev-session-secret-change-me"
	}
	app := &App{
		static:        static,
		db:            db,
		billingConfig: options.Billing,
		stripe:        billing.NewStripeClient(options.Billing.StripeSecretKey, "", nil),
	}
	if db != nil {
		app.auth = auth.NewService(auth.NewPGStore(db), options.SessionSecret, options.CookieSecure, auth.WithAppBaseURL(options.Billing.AppBaseURL))
		app.docs = documents.NewHandler(documents.NewStore(db))
		app.billing = billing.NewService(billing.NewPGStore(db), options.Billing)
	}
	return app
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/v1/me", a.me)
	mux.HandleFunc("POST /api/v1/auth/register", a.register)
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("POST /api/v1/auth/magic-link", a.requestMagicLink)
	mux.HandleFunc("POST /api/v1/auth/magic-link/verify", a.verifyMagicLink)
	mux.HandleFunc("GET /api/v1/admin/users/{email}/account", a.adminGetAccount)
	mux.HandleFunc("PATCH /api/v1/admin/users/{email}/account", a.adminUpdateAccount)
	mux.HandleFunc("POST /api/v1/billing/checkout", a.createCheckoutSession)
	mux.HandleFunc("POST /api/v1/billing/portal", a.createPortalSession)
	mux.HandleFunc("POST /api/v1/billing/webhook", a.stripeWebhook)
	mux.HandleFunc("GET /api/v1/api-tokens", a.listAPITokens)
	mux.HandleFunc("POST /api/v1/api-tokens", a.createAPIToken)
	mux.HandleFunc("DELETE /api/v1/api-tokens/{id}", a.revokeAPIToken)
	mux.HandleFunc("GET /api/v1/docs", a.listDocs)
	mux.HandleFunc("POST /api/v1/docs", a.createDoc)
	mux.HandleFunc("GET /api/v1/docs/{id}", a.getDoc)
	mux.HandleFunc("PATCH /api/v1/docs/{id}", a.updateDoc)
	mux.HandleFunc("DELETE /api/v1/docs/{id}", a.archiveDoc)
	mux.HandleFunc("POST /api/v1/docs/{id}/share", a.shareDoc)
	mux.HandleFunc("DELETE /api/v1/docs/{id}/share", a.unshareDoc)
	mux.HandleFunc("GET /d/{token}", a.publicDoc)
	mux.HandleFunc("GET /write", a.write)
	mux.HandleFunc("GET /write/{$}", a.write)
	mux.HandleFunc("GET /write/{publicId}", a.write)
	mux.Handle("/", StaticHandler(a.static))
	return mux
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	status := "not_configured"
	if a.db != nil {
		status = "ok"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":   "ok",
		"database": status,
	})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
		return
	}
	user, ok := a.auth.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
		return
	}
	response := map[string]any{
		"authenticated": true,
		"user":          user,
	}
	if a.billing != nil {
		account, err := a.billing.Account(r.Context(), user)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account could not be loaded"})
			return
		}
		response["account"] = account
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusForbidden, map[string]string{"error": "Passage is in closed beta"})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.Login(w, r)
}

func (a *App) requestMagicLink(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequestMagicLink(w, r)
}

func (a *App) verifyMagicLink(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.VerifyMagicLink(w, r)
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		http.SetCookie(w, &http.Cookie{
			Name:     auth.CookieName,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	a.auth.Logout(w, r)
}

func (a *App) adminGetAccount(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, admin auth.User) {
		user, account, err := a.billing.AdminAccountByEmail(r.Context(), admin, r.PathValue("email"))
		a.writeAdminAccountResponse(w, user, account, err)
	})(w, r)
}

func (a *App) adminUpdateAccount(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, admin auth.User) {
		if !validateJSONMutation(w, r) {
			return
		}
		var input adminAccountInput
		if !decodeJSON(w, r, &input) {
			return
		}
		plan, maxSavedDocs, ok := input.overrideValues(w)
		if !ok {
			return
		}
		user, account, err := a.billing.UpdateAdminOverride(r.Context(), admin, r.PathValue("email"), plan, maxSavedDocs)
		a.writeAdminAccountResponse(w, user, account, err)
	})(w, r)
}

func (a *App) writeAdminAccountResponse(w http.ResponseWriter, user auth.User, account billing.Account, err error) {
	if errors.Is(err, billing.ErrNotAdmin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
		return
	}
	if errors.Is(err, billing.ErrUserNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account could not be loaded"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":    user,
		"account": account,
	})
}

func (a *App) createCheckoutSession(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	if !validateSameOriginMutation(w, r) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requireStripeBilling(w) {
			return
		}
		account, err := a.billing.Account(r.Context(), user)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account could not be loaded"})
			return
		}
		customerID := account.Subscription.StripeCustomerID
		if customerID == "" {
			customerID, err = a.stripe.CreateCustomer(r.Context(), billing.CustomerParams{
				Email:  user.Email,
				UserID: user.ID,
			})
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Stripe customer could not be created"})
				return
			}
			if err := a.billing.SetStripeCustomer(r.Context(), user.ID, customerID); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "billing customer could not be saved"})
				return
			}
		}
		sessionURL, err := a.stripe.CreateCheckoutSession(r.Context(), billing.CheckoutParams{
			CustomerID:     customerID,
			UserID:         user.ID,
			MonthlyPriceID: a.billingConfig.StripeMonthlyPrice,
			SuccessURL:     absoluteAppURL(a.billingConfig.AppBaseURL, "/account?billing=success"),
			CancelURL:      absoluteAppURL(a.billingConfig.AppBaseURL, "/account?billing=cancel"),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Stripe Checkout could not be created"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": sessionURL})
	})(w, r)
}

func (a *App) createPortalSession(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	if !validateSameOriginMutation(w, r) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requireStripeBilling(w) {
			return
		}
		account, err := a.billing.Account(r.Context(), user)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account could not be loaded"})
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
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Stripe customer portal could not be created"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": sessionURL})
	})(w, r)
}

func (a *App) requireAuthService(w http.ResponseWriter) bool {
	if a.auth == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) listAPITokens(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequireSessionUser(a.auth.ListAPITokens)(w, r)
}

func (a *App) createAPIToken(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requirePro(w, r, user) {
			return
		}
		a.auth.CreateAPIToken(w, r, user)
	})(w, r)
}

func (a *App) revokeAPIToken(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequireSessionUser(a.auth.RevokeAPIToken)(w, r)
}

func (a *App) listDocs(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.List)(w, r)
}

func (a *App) createDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if a.billing != nil {
			if _, err := a.billing.EnsureCanCreateDoc(r.Context(), user); err != nil {
				if errors.Is(err, billing.ErrLimitReached) {
					writePaymentRequired(w, "saved document limit reached")
					return
				}
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account could not be loaded"})
				return
			}
		}
		a.docs.Create(w, r, user)
	})(w, r)
}

func (a *App) getDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.Get)(w, r)
}

func (a *App) updateDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.Update)(w, r)
}

func (a *App) archiveDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.Archive)(w, r)
}

func (a *App) shareDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.requirePro(w, r, user) {
			return
		}
		a.docs.Share(w, r, user)
	})(w, r)
}

func (a *App) unshareDoc(w http.ResponseWriter, r *http.Request) {
	if !a.requireDocumentService(w) {
		return
	}
	a.requireUserForDocs(a.docs.Unshare)(w, r)
}

func (a *App) publicDoc(w http.ResponseWriter, r *http.Request) {
	if a.docs == nil {
		http.NotFound(w, r)
		return
	}
	a.docs.Public(w, r)
}

func (a *App) write(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		redirectToLogin(w, r)
		return
	}
	if _, ok := a.auth.UserFromSessionRequest(r); !ok {
		redirectToLogin(w, r)
		return
	}
	serveFile(w, r, a.static, "write.html")
}

func redirectToLogin(w http.ResponseWriter, r *http.Request) {
	next := r.URL.RequestURI()
	if next == "" {
		next = "/write"
	}
	http.Redirect(w, r, "/login?next="+url.QueryEscape(next), http.StatusFound)
}

func (a *App) requireDocumentService(w http.ResponseWriter) bool {
	if a.auth == nil || a.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) requireBillingService(w http.ResponseWriter) bool {
	if a.auth == nil || a.billing == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func (a *App) requireStripeBilling(w http.ResponseWriter) bool {
	if !a.billingConfig.StripeBillingEnabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Stripe billing is disabled"})
		return false
	}
	if !a.billingConfig.StripeConfigured() {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Stripe billing is not configured"})
		return false
	}
	return true
}

func (a *App) requireUserForDocs(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if user, ok := a.auth.UserFromSessionRequest(r); ok {
			next(w, r, user)
			return
		}
		if user, ok := a.auth.UserFromBearerRequest(r); ok {
			if !a.requirePro(w, r, user) {
				return
			}
			next(w, r, user)
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "account could not be loaded"})
		return false
	}
	return true
}

func writePaymentRequired(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type adminAccountInput struct {
	Plan         *string `json:"plan"`
	MaxSavedDocs *int    `json:"maxSavedDocs"`
}

func (i adminAccountInput) overrideValues(w http.ResponseWriter) (*billing.Plan, *int, bool) {
	var plan *billing.Plan
	if i.Plan != nil {
		switch *i.Plan {
		case "", "none", "null":
			plan = nil
		case string(billing.PlanFree), string(billing.PlanPro):
			value := billing.Plan(*i.Plan)
			plan = &value
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "plan must be free or pro"})
			return nil, nil, false
		}
	}
	if i.MaxSavedDocs != nil && *i.MaxSavedDocs < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "maxSavedDocs must be zero or greater"})
		return nil, nil, false
	}
	return plan, i.MaxSavedDocs, true
}

func validateJSONMutation(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
		return false
	}
	return validateSameOriginMutation(w, r)
}

func validateSameOriginMutation(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		expected := scheme(r) + "://" + r.Host
		if origin != expected {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin requests are not allowed"})
			return false
		}
	}
	return true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return false
	}
	return true
}

func scheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" || proto == "http" {
		return proto
	}
	return "http"
}

func absoluteAppURL(base string, path string) string {
	base = strings.TrimRight(base, "/")
	if base == "" {
		base = "http://localhost:8080"
	}
	return base + path
}
