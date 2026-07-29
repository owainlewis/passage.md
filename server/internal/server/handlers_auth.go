package server

import (
	"errors"
	"net/http"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/community"
	"github.com/owainlewis/passage.md/server/internal/httpx"
	"github.com/owainlewis/passage.md/server/internal/policy"
)

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	response := map[string]any{
		"authenticated":       false,
		"publicSignupEnabled": a.publicSignupEnabled && !a.writesDisabled,
		"policyVersion":       policy.CurrentVersion,
	}
	if a.auth == nil {
		writeJSON(w, http.StatusOK, response)
		return
	}
	user, ok := a.auth.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusOK, response)
		return
	}
	response["authenticated"] = true
	response["user"] = user
	if a.billing != nil {
		account, err := a.billing.Account(r.Context(), user)
		if err != nil {
			httpx.WriteInternalError(w, r, "load current account", err, "account could not be loaded")
			return
		}
		response["account"] = account
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.publicSignupEnabled {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Public signup is not open"})
		return
	}
	if !a.requireAuthService(w) {
		return
	}
	a.auth.Register(w, r)
}

func (a *App) validateReferral(w http.ResponseWriter, r *http.Request) {
	if a.community == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return
	}
	if !validateJSONMutation(w, r) {
		return
	}
	var input communityReferralCredentials
	if !decodeJSON(w, r, &input) {
		return
	}
	referral, err := a.community.ValidateReferral(r.Context(), input.Ref, input.Code)
	if errors.Is(err, community.ErrInvalidReferral) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": community.InvalidReferralMessage()})
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, r, "validate community referral", err, "referral could not be validated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"name":          referral.Name,
		"policyVersion": policy.CurrentVersion,
	})
}

func (a *App) referralSignup(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil || a.community == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return
	}
	if !validateJSONMutation(w, r) {
		return
	}
	var input communityReferralSignupInput
	if !decodeJSON(w, r, &input) {
		return
	}
	user, session, err := a.community.Redeem(r.Context(), input.Ref, input.Code, input.Email, input.Password, input.PolicyVersion)
	if errors.Is(err, community.ErrInvalidReferral) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": community.InvalidReferralMessage()})
		return
	}
	if errors.Is(err, community.ErrEmailTaken) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
		return
	}
	if errors.Is(err, community.ErrPolicyRequired) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err != nil {
		message := err.Error()
		if message == "valid email is required" || message == "password must be at least 8 characters" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
			return
		}
		httpx.WriteInternalError(w, r, "redeem community referral", err, "account could not be created")
		return
	}
	a.auth.WriteSessionCookie(w, session)
	writeJSON(w, http.StatusCreated, map[string]any{"authenticated": true, "user": user})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.Login(w, r)
}

func (a *App) requestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.RequestPasswordReset(w, r)
}

func (a *App) resetPassword(w http.ResponseWriter, r *http.Request) {
	if !a.requireAuthService(w) {
		return
	}
	a.auth.ResetPassword(w, r)
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

func (a *App) requireAuthService(w http.ResponseWriter) bool {
	if a.auth == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

type communityReferralSignupInput struct {
	Ref           string `json:"ref"`
	Code          string `json:"code"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	PolicyVersion string `json:"policyVersion"`
}

type communityReferralCredentials struct {
	Ref  string `json:"ref"`
	Code string `json:"code"`
}
