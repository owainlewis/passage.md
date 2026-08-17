package server

import (
	"context"
	"io/fs"
	"net/http"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/collections"
	"github.com/owainlewis/passage.md/server/internal/community"
	"github.com/owainlewis/passage.md/server/internal/config"
	"github.com/owainlewis/passage.md/server/internal/database"
	"github.com/owainlewis/passage.md/server/internal/documents"
	"github.com/owainlewis/passage.md/server/internal/httpx"
	"github.com/owainlewis/passage.md/server/internal/templates"
)

type Options struct {
	SessionSecret       string
	CookieSecure        bool
	AppBaseURL          string
	PasswordResetSender auth.PasswordResetSender
	Billing             config.BillingConfig
	RateLimits          config.AbuseRateLimitConfig
	Proxy               config.ProxyConfig
	GCPProjectID        string
	WritesDisabled      bool
	PublicSignupEnabled bool
}

type App struct {
	static              fs.FS
	databaseHealth      databasePinger
	auth                *auth.Service
	docs                *documents.Handler
	collections         *collections.Handler
	templates           *templates.Handler
	billing             *billing.Service
	community           *community.Service
	stripe              *billing.StripeClient
	billingConfig       config.BillingConfig
	rateLimiters        appRateLimiters
	clientIP            httpx.ClientIPResolver
	gcpProjectID        string
	writesDisabled      bool
	publicSignupEnabled bool
}

type databasePinger interface {
	Ping(context.Context) error
}

const stripeCustomerCleanupTimeout = 30 * time.Second

func NewApp(static fs.FS, db *database.Pool, opts ...Options) *App {
	var options Options
	if len(opts) > 0 {
		options = opts[0]
	}
	if options.SessionSecret == "" {
		options.SessionSecret = "dev-session-secret-change-me"
	}
	clientIP := httpx.NewClientIPResolver(options.Proxy.TrustedCIDRs, options.Proxy.ForwardedHops)
	rateLimiters := newAppRateLimiters(options.RateLimits)
	// Recovery mode must remain database read-only. Its outer write fence blocks
	// mutations, while the allowed reads temporarily retain process-local limits.
	if db != nil && !options.WritesDisabled {
		rateLimiters = newPersistentAppRateLimiters(options.RateLimits, newPGRateLimitStore(db), options.SessionSecret)
	}
	app := &App{
		static:              static,
		billingConfig:       options.Billing,
		gcpProjectID:        options.GCPProjectID,
		stripe:              billing.NewStripeClient(options.Billing.StripeSecretKey, "", nil),
		rateLimiters:        rateLimiters,
		clientIP:            clientIP,
		writesDisabled:      options.WritesDisabled,
		publicSignupEnabled: options.PublicSignupEnabled,
	}
	if db != nil {
		app.databaseHealth = db
		app.auth = auth.NewServiceWithOptions(auth.NewPGStore(db), options.SessionSecret, options.CookieSecure, auth.Options{
			AppBaseURL:          options.AppBaseURL,
			PasswordResetSender: options.PasswordResetSender,
			ClientIP:            clientIP.Resolve,
			WritesDisabled:      options.WritesDisabled,
		})
		app.community = community.NewService(community.NewPGStore(db), app.auth)
		app.docs = documents.NewHandler(documents.NewStore(db), func(r *http.Request) documents.Actor {
			actor, ok := app.auth.ActorFromRequest(r)
			if !ok || !actor.IsAPIToken() {
				return documents.Actor{}
			}
			return documents.Actor{TokenID: actor.TokenID, TokenName: actor.TokenName}
		})
		app.collections = collections.NewHandler(collections.NewStore(db))
		app.templates = templates.NewHandler(templates.NewStore(db))
		app.billing = billing.NewService(billing.NewPGStore(db), options.Billing)
	}
	return app
}

func (a *App) RunPasswordResetWorker(ctx context.Context) {
	if !a.writesDisabled && a.auth != nil {
		a.auth.RunPasswordResetWorker(ctx)
	}
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/v1/me", a.me)
	mux.HandleFunc("POST /api/v1/auth/register", a.limitAuthMutation(a.register))
	mux.HandleFunc("POST /api/v1/auth/referral/validate", a.limitAuthMutation(a.validateReferral))
	mux.HandleFunc("POST /api/v1/auth/referral-signup", a.limitAuthMutation(a.referralSignup))
	mux.HandleFunc("POST /api/v1/auth/login", a.limitAuthMutation(a.login))
	mux.HandleFunc("POST /api/v1/auth/logout", a.limitAuthMutation(a.logout))
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", a.requestPasswordReset)
	mux.HandleFunc("POST /api/v1/auth/password-reset/confirm", a.resetPassword)
	mux.HandleFunc("GET /api/v1/admin/dashboard", a.adminDashboard)
	mux.HandleFunc("GET /api/v1/admin/users/{email}/account", a.adminGetAccount)
	mux.HandleFunc("PATCH /api/v1/admin/users/{email}/account", a.adminUpdateAccount)
	mux.HandleFunc("POST /api/v1/admin/community-referrals", a.adminCreateCommunityReferral)
	mux.HandleFunc("POST /api/v1/admin/community-referrals/{id}/rotate", a.adminRotateCommunityReferral)
	mux.HandleFunc("POST /api/v1/admin/community-referrals/{id}/disable", a.adminDisableCommunityReferral)
	mux.HandleFunc("POST /api/v1/admin/community-grants/revoke", a.adminRevokeCommunityGrant)
	mux.HandleFunc("POST /api/v1/billing/checkout", a.createCheckoutSession)
	mux.HandleFunc("POST /api/v1/billing/portal", a.createPortalSession)
	mux.HandleFunc("POST /api/v1/billing/webhook", a.stripeWebhook)
	mux.HandleFunc("GET /api/v1/api-tokens", a.listAPITokens)
	mux.HandleFunc("POST /api/v1/api-tokens", a.createAPIToken)
	mux.HandleFunc("DELETE /api/v1/api-tokens/{id}", a.revokeAPIToken)
	mux.HandleFunc("GET /api/v1/docs", a.listDocs)
	mux.HandleFunc("GET /api/v1/docs/search", a.searchDocs)
	mux.HandleFunc("POST /api/v1/docs", a.createDoc)
	mux.HandleFunc("GET /api/v1/docs/{id}", a.getDoc)
	mux.HandleFunc("PATCH /api/v1/docs/{id}", a.updateDoc)
	mux.HandleFunc("DELETE /api/v1/docs/{id}", a.archiveDoc)
	mux.HandleFunc("POST /api/v1/docs/{id}/share", a.shareDoc)
	mux.HandleFunc("DELETE /api/v1/docs/{id}/share", a.unshareDoc)
	mux.HandleFunc("GET /api/v1/collections", a.listCollections)
	mux.HandleFunc("POST /api/v1/collections", a.createCollection)
	mux.HandleFunc("PATCH /api/v1/collections/{slug}", a.updateCollection)
	mux.HandleFunc("DELETE /api/v1/collections/{slug}", a.deleteCollection)
	mux.HandleFunc("GET /api/v1/templates", a.listTemplates)
	mux.HandleFunc("POST /api/v1/templates", a.createTemplate)
	mux.HandleFunc("GET /api/v1/templates/{id}", a.getTemplate)
	mux.HandleFunc("PATCH /api/v1/templates/{id}", a.updateTemplate)
	mux.HandleFunc("DELETE /api/v1/templates/{id}", a.deleteTemplate)
	mux.HandleFunc("GET /d/{token}", a.limitPublicDocument(a.publicDoc))
	mux.HandleFunc("GET /write", a.write)
	mux.HandleFunc("GET /write/{$}", a.write)
	mux.HandleFunc("GET /write/{publicId}", a.write)
	mux.Handle("/", StaticHandler(a.static))
	var handler http.Handler = mux
	if a.writesDisabled {
		handler = writeFence(handler)
	}
	return httpx.WithRequestContext(handler, a.gcpProjectID)
}

func writeFence(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Retry-After", "60")
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "writes are temporarily disabled for database recovery",
			})
		}
	})
}
