package community

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/policy"
	"golang.org/x/crypto/bcrypt"
)

func TestCreateReferralReturnsPlaintextOnceAndStoresOnlyHash(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	referral, err := service.CreateReferral(context.Background(), " AIEngineer ", " AI Engineer ")
	if err != nil {
		t.Fatal(err)
	}
	if referral.Slug != "aiengineer" || referral.Name != "AI Engineer" || !strings.HasPrefix(referral.Code, "PASS-") {
		t.Fatalf("referral = %#v", referral)
	}
	if referral.SignupURL != "/signup#ref=aiengineer&code="+referral.Code {
		t.Fatalf("signup URL = %q", referral.SignupURL)
	}
	if store.codeHash == referral.Code || store.codeHash != HashCode(referral.Code) {
		t.Fatalf("stored hash = %q", store.codeHash)
	}
}

func TestCreateReferralValidatesSlugAndName(t *testing.T) {
	service := NewService(&memoryStore{}, auth.NewService(nil, "secret", false))
	for _, input := range []struct{ slug, name string }{{"ai engineer", "AI Engineer"}, {"ai--engineer", "AI Engineer"}, {"aiengineer", ""}} {
		if _, err := service.CreateReferral(context.Background(), input.slug, input.name); err == nil {
			t.Fatalf("CreateReferral(%q, %q) succeeded", input.slug, input.name)
		}
	}
}

func TestCreateReferralFromCodeHashNeverNeedsPlaintext(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	codeHash := strings.Repeat("a1", 32)

	referral, err := service.CreateReferralFromCodeHash(context.Background(), " Launch-Test ", " Launch test ", codeHash)
	if err != nil {
		t.Fatal(err)
	}
	if referral.Slug != "launch-test" || referral.Name != "Launch test" || referral.CodeHash != codeHash {
		t.Fatalf("referral = %#v", referral)
	}
	if store.codeHash != codeHash {
		t.Fatalf("stored hash = %q", store.codeHash)
	}
}

func TestCreateReferralFromCodeHashRejectsPlaintextAndMalformedHashes(t *testing.T) {
	service := NewService(&memoryStore{}, auth.NewService(nil, "secret", false))
	for _, codeHash := range []string{
		"PASS-0123-4567-89AB-CDEF",
		strings.Repeat("a", 63),
		strings.Repeat("A", 64),
		strings.Repeat("g", 64),
	} {
		if _, err := service.CreateReferralFromCodeHash(context.Background(), "launch-test", "Launch test", codeHash); err == nil {
			t.Fatalf("CreateReferralFromCodeHash accepted %q", codeHash)
		}
	}
}

func TestNormalizeCodeIsCaseInsensitiveAndSeparatorInsensitive(t *testing.T) {
	formatted := "PASS-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF"
	compact := " pass 0123456789abcdef0123456789abcdef "
	if HashCode(formatted) != HashCode(compact) {
		t.Fatal("hashes differ")
	}
}

func TestValidateReferralReturnsNameAndPassesOnlyHash(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	plain := "PASS-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF"
	referral, err := service.ValidateReferral(context.Background(), " AIEngineer ", strings.ToLower(plain))
	if err != nil {
		t.Fatal(err)
	}
	if referral.Name != "AI Engineer" || store.slug != "aiengineer" || store.codeHash != HashCode(plain) || store.codeHash == plain {
		t.Fatalf("referral/slug/hash = %#v/%q/%q", referral, store.slug, store.codeHash)
	}
}

func TestRedeemHashesPasswordAfterReferralValidation(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	service.now = func() time.Time { return time.Unix(100, 0).UTC() }
	plain := "PASS-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF"
	user, session, err := service.Redeem(context.Background(), "aiengineer", plain, " USER@example.com ", "password123", policy.CurrentVersion)
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != "user@example.com" || store.slug != "aiengineer" || store.codeHash != HashCode(plain) {
		t.Fatalf("user/store = %#v/%#v", user, store)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.passwordHash), []byte("password123")) != nil {
		t.Fatal("password was not bcrypt hashed")
	}
	if session.TokenHash == "" || session.CookieValue == "" || !session.ExpiresAt.After(service.now()) {
		t.Fatalf("session = %#v", session)
	}
	if store.policyVersion != policy.CurrentVersion || !store.acceptedAt.Equal(service.now()) {
		t.Fatalf("policy acceptance = %q/%s", store.policyVersion, store.acceptedAt)
	}
}

func TestInvalidOrDisabledReferralSkipsPasswordHashing(t *testing.T) {
	store := &memoryStore{findErr: ErrReferralNotFound}
	service := NewService(store, auth.NewService(nil, "secret", false))
	hashCalls := 0
	service.hashPassword = func(string) (string, error) { hashCalls++; return "hash", nil }
	_, _, err := service.Redeem(context.Background(), "aiengineer", "PASS-INVALID", "member@example.com", "password123", policy.CurrentVersion)
	if !errors.Is(err, ErrInvalidReferral) {
		t.Fatalf("error = %v", err)
	}
	if hashCalls != 0 || store.redeemCalls != 0 {
		t.Fatalf("hash/redeem calls = %d/%d", hashCalls, store.redeemCalls)
	}
}

func TestRedeemKeepsTransactionalRecheckAsFinalAuthority(t *testing.T) {
	store := &memoryStore{redeemErr: ErrInvalidReferral}
	service := NewService(store, auth.NewService(nil, "secret", false))
	service.hashPassword = func(string) (string, error) { return "hash", nil }
	_, _, err := service.Redeem(context.Background(), "aiengineer", "PASS-RACE", "race@example.com", "password123", policy.CurrentVersion)
	if !errors.Is(err, ErrInvalidReferral) || store.redeemCalls != 1 {
		t.Fatalf("error/calls = %v/%d", err, store.redeemCalls)
	}
}

func TestRedeemRejectsMissingOrStalePolicyAcceptanceBeforeReferralLookup(t *testing.T) {
	for _, version := range []string{"", "2025-01-01"} {
		store := &memoryStore{}
		service := NewService(store, auth.NewService(nil, "secret", false))
		hashCalls := 0
		service.hashPassword = func(string) (string, error) { hashCalls++; return "hash", nil }

		_, _, err := service.Redeem(context.Background(), "aiengineer", "PASS-VALID", "member@example.com", "password123", version)

		if !errors.Is(err, ErrPolicyRequired) {
			t.Fatalf("version %q error = %v", version, err)
		}
		if store.slug != "" || hashCalls != 0 || store.redeemCalls != 0 {
			t.Fatalf("version %q touched referral/password/store: %#v/%d", version, store, hashCalls)
		}
	}
}

func TestReferralLifecycleAndGrantRevocationDelegateToStore(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	service.now = func() time.Time { return time.Unix(100, 0).UTC() }
	id := "11111111-1111-1111-1111-111111111111"
	rotated, err := service.RotateReferral(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.SignupURL != "/signup#ref=aiengineer&code="+rotated.Code || store.rotatedID != id {
		t.Fatalf("rotated/store = %#v/%#v", rotated, store)
	}
	if err := service.DisableReferral(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if err := service.DisableReferralBySlug(context.Background(), " AIEngineer "); err != nil {
		t.Fatal(err)
	}
	if err := service.RevokeGrant(context.Background(), " MEMBER@example.com ", " membership ended "); err != nil {
		t.Fatal(err)
	}
	if store.disabledID != id || store.disabledSlug != "aiengineer" || store.revokedEmail != "member@example.com" || store.reason != "membership ended" {
		t.Fatalf("store = %#v", store)
	}
}

func TestReferralLifecycleRejectsMalformedIDsBeforeStore(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	if _, err := service.RotateReferral(context.Background(), "not-a-uuid"); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("rotate error = %v", err)
	}
	if err := service.DisableReferral(context.Background(), "not-a-uuid"); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("disable error = %v", err)
	}
	if err := service.DisableReferralBySlug(context.Background(), "not a slug"); !errors.Is(err, ErrReferralNotFound) {
		t.Fatalf("disable by slug error = %v", err)
	}
	if store.rotatedID != "" || store.disabledID != "" || store.disabledSlug != "" {
		t.Fatalf("store called: %#v", store)
	}
}

type memoryStore struct {
	slug, codeHash, passwordHash                              string
	findErr, redeemErr                                        error
	redeemCalls                                               int
	rotatedID, disabledID, disabledSlug, revokedEmail, reason string
	policyVersion                                             string
	acceptedAt                                                time.Time
}

func (s *memoryStore) CreateReferral(_ context.Context, slug, name, codeHash string) (StoredReferral, error) {
	s.slug, s.codeHash = slug, codeHash
	return StoredReferral{ID: "11111111-1111-1111-1111-111111111111", Slug: slug, Name: name, CodeHash: codeHash, CreatedAt: time.Unix(1, 0).UTC()}, nil
}

func (s *memoryStore) FindActiveReferral(_ context.Context, slug, codeHash string) (StoredReferral, error) {
	s.slug, s.codeHash = slug, codeHash
	if s.findErr != nil {
		return StoredReferral{}, s.findErr
	}
	return StoredReferral{ID: "11111111-1111-1111-1111-111111111111", Slug: slug, Name: "AI Engineer", CodeHash: codeHash}, nil
}

func (s *memoryStore) Redeem(_ context.Context, slug, codeHash, email, passwordHash, policyVersion string, _ auth.PreparedSession, acceptedAt time.Time) (auth.User, error) {
	s.redeemCalls++
	s.slug, s.codeHash, s.passwordHash = slug, codeHash, passwordHash
	s.policyVersion, s.acceptedAt = policyVersion, acceptedAt
	if s.redeemErr != nil {
		return auth.User{}, s.redeemErr
	}
	return auth.User{ID: "user-1", Email: email}, nil
}

func (s *memoryStore) RotateReferral(_ context.Context, id, codeHash string, _ time.Time) (StoredReferral, error) {
	s.rotatedID, s.codeHash = id, codeHash
	return StoredReferral{ID: id, Slug: "aiengineer", Name: "AI Engineer", CodeHash: codeHash}, nil
}

func (s *memoryStore) DisableReferral(_ context.Context, id string, _ time.Time) error {
	s.disabledID = id
	return nil
}
func (s *memoryStore) DisableReferralBySlug(_ context.Context, slug string, _ time.Time) error {
	s.disabledSlug = slug
	return nil
}
func (s *memoryStore) RevokeGrant(_ context.Context, email, reason string, _ time.Time) error {
	s.revokedEmail, s.reason = email, reason
	return nil
}
