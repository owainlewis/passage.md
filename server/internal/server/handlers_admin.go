package server

import (
	"errors"
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/billing"
	"github.com/owainlewis/passage.md/server/internal/community"
	"github.com/owainlewis/passage.md/server/internal/httpx"
)

func (a *App) adminDashboard(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, admin auth.User) {
		dashboard, err := a.billing.AdminDashboard(r.Context(), admin)
		if errors.Is(err, billing.ErrNotAdmin) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
			return
		}
		if err != nil {
			httpx.WriteInternalError(w, r, "load admin dashboard", err, "admin dashboard could not be loaded")
			return
		}
		writeJSON(w, http.StatusOK, dashboard)
	})(w, r)
}

func (a *App) adminGetAccount(w http.ResponseWriter, r *http.Request) {
	if !a.requireBillingService(w) {
		return
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, admin auth.User) {
		user, account, err := a.billing.AdminAccountByEmail(r.Context(), admin, r.PathValue("email"))
		a.writeAdminAccountResponse(w, r, user, account, err)
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
		a.writeAdminAccountResponse(w, r, user, account, err)
	})(w, r)
}

func (a *App) adminCreateCommunityReferral(w http.ResponseWriter, r *http.Request) {
	if !a.requireCommunityAdmin(w, r, func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		if !validateJSONMutation(w, r) {
			return
		}
		var input communityReferralInput
		if !decodeJSON(w, r, &input) {
			return
		}
		referral, err := a.community.CreateReferral(r.Context(), input.Slug, input.Name)
		if errors.Is(err, community.ErrReferralExists) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "community referral already exists"})
			return
		}
		if err != nil {
			message := err.Error()
			if message == "referral slug must contain lowercase letters, numbers, and single hyphens" || message == "referral name is required" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
				return
			}
			httpx.WriteInternalError(w, r, "create community referral", err, "community referral could not be created")
			return
		}
		writeJSON(w, http.StatusCreated, referral)
	}) {
		return
	}
}

func (a *App) adminRotateCommunityReferral(w http.ResponseWriter, r *http.Request) {
	if !a.requireCommunityAdmin(w, r, func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		if !validateJSONMutation(w, r) {
			return
		}
		referral, err := a.community.RotateReferral(r.Context(), r.PathValue("id"))
		if errors.Is(err, community.ErrReferralNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "community referral not found"})
			return
		}
		if err != nil {
			httpx.WriteInternalError(w, r, "rotate community referral", err, "community referral could not be rotated")
			return
		}
		writeJSON(w, http.StatusOK, referral)
	}) {
		return
	}
}

func (a *App) adminDisableCommunityReferral(w http.ResponseWriter, r *http.Request) {
	if !a.requireCommunityAdmin(w, r, func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		if !validateJSONMutation(w, r) {
			return
		}
		err := a.community.DisableReferral(r.Context(), r.PathValue("id"))
		if errors.Is(err, community.ErrReferralNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "community referral not found"})
			return
		}
		if err != nil {
			httpx.WriteInternalError(w, r, "disable community referral", err, "community referral could not be disabled")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}) {
		return
	}
}

func (a *App) adminRevokeCommunityGrant(w http.ResponseWriter, r *http.Request) {
	if !a.requireCommunityAdmin(w, r, func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		if !validateJSONMutation(w, r) {
			return
		}
		var input communityGrantRevokeInput
		if !decodeJSON(w, r, &input) {
			return
		}
		err := a.community.RevokeGrant(r.Context(), input.Email, input.Reason)
		if errors.Is(err, community.ErrGrantNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "community grant not found"})
			return
		}
		if err != nil {
			if err.Error() == "valid email is required" || err.Error() == "revocation reason is required" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			httpx.WriteInternalError(w, r, "revoke community grant", err, "community grant could not be revoked")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}) {
		return
	}
}

func (a *App) requireCommunityAdmin(w http.ResponseWriter, r *http.Request, next func(http.ResponseWriter, *http.Request, auth.User)) bool {
	if a.auth == nil || a.billing == nil || a.community == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	a.auth.RequireSessionUser(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !a.billing.IsAdmin(user.Email) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
			return
		}
		next(w, r, user)
	})(w, r)
	return true
}

func (a *App) writeAdminAccountResponse(w http.ResponseWriter, r *http.Request, user auth.User, account billing.Account, err error) {
	if errors.Is(err, billing.ErrNotAdmin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
		return
	}
	if errors.Is(err, billing.ErrUserNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "load admin account", err, "account could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":    user,
		"account": account,
	})
}

type adminAccountInput struct {
	Plan         *string `json:"plan"`
	MaxSavedDocs *int    `json:"maxSavedDocs"`
}

type communityReferralInput struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type communityGrantRevokeInput struct {
	Email  string `json:"email"`
	Reason string `json:"reason"`
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
