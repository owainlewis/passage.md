package community

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

func TestGenerateReturnsPlaintextOnceAndStoresNormalizedHashes(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	codes, err := service.Generate(context.Background(), "  Community launch  ", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 3 || len(store.hashes) != 3 {
		t.Fatalf("codes/hashes = %d/%d", len(codes), len(store.hashes))
	}
	seen := map[string]bool{}
	for i, code := range codes {
		if !strings.HasPrefix(code.Code, "PASS-") {
			t.Fatalf("code = %q", code.Code)
		}
		if len(NormalizeCode(code.Code)) != 36 {
			t.Fatalf("normalized code length = %d", len(NormalizeCode(code.Code)))
		}
		if store.hashes[i] == code.Code || store.hashes[i] != HashCode(strings.ToLower(code.Code)) {
			t.Fatalf("stored value is not the normalized hash: %q", store.hashes[i])
		}
		if seen[code.Code] {
			t.Fatalf("duplicate code = %q", code.Code)
		}
		seen[code.Code] = true
		if code.BatchLabel != "Community launch" {
			t.Fatalf("label = %q", code.BatchLabel)
		}
	}
}

func TestNormalizeCodeIsCaseInsensitiveAndSeparatorInsensitive(t *testing.T) {
	formatted := "PASS-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF"
	compact := " pass 0123456789abcdef0123456789abcdef "
	if HashCode(formatted) != HashCode(compact) {
		t.Fatalf("hashes differ: %q %q", HashCode(formatted), HashCode(compact))
	}
}

func TestRedeemValidatesAndPassesOnlyHashToStore(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	service.now = func() time.Time { return time.Unix(100, 0).UTC() }
	plain := "PASS-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF"
	user, session, err := service.Redeem(context.Background(), strings.ToLower(plain), " USER@example.com ", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != "user@example.com" || store.codeHash != HashCode(plain) || store.codeHash == plain {
		t.Fatalf("user/hash = %#v/%q", user, store.codeHash)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.passwordHash), []byte("password123")) != nil {
		t.Fatal("password was not bcrypt hashed")
	}
	if session.TokenHash == "" || session.CookieValue == "" || !session.ExpiresAt.After(service.now()) {
		t.Fatalf("session = %#v", session)
	}
}

func TestDisabledUsedAndRevokedCodesAreRejected(t *testing.T) {
	for _, state := range []string{"invalid", "disabled", "used", "revoked"} {
		t.Run(state, func(t *testing.T) {
			store := &memoryStore{unredeemable: true}
			service := NewService(store, auth.NewService(nil, "secret", false))
			hashCalls := 0
			service.hashPassword = func(string) (string, error) {
				hashCalls++
				return "hash", nil
			}
			_, _, err := service.Redeem(context.Background(), "PASS-INVALID", state+"@example.com", "password123")
			if !errors.Is(err, ErrInvalidCode) {
				t.Fatalf("error = %v", err)
			}
			if hashCalls != 0 || store.redeemCalls != 0 {
				t.Fatalf("hash/redeem calls = %d/%d", hashCalls, store.redeemCalls)
			}
		})
	}
}

func TestRedeemKeepsTransactionalRecheckAsFinalAuthority(t *testing.T) {
	store := &memoryStore{redeemErr: ErrInvalidCode}
	service := NewService(store, auth.NewService(nil, "secret", false))
	hashCalls := 0
	service.hashPassword = func(string) (string, error) {
		hashCalls++
		return "hash", nil
	}

	_, _, err := service.Redeem(context.Background(), "PASS-RACE", "race@example.com", "password123")
	if !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("error = %v", err)
	}
	if hashCalls != 1 || store.redeemCalls != 1 {
		t.Fatalf("hash/redeem calls = %d/%d", hashCalls, store.redeemCalls)
	}
}

func TestDisableAndRevokeDelegateToStore(t *testing.T) {
	store := &memoryStore{}
	service := NewService(store, auth.NewService(nil, "secret", false))
	service.now = func() time.Time { return time.Unix(100, 0).UTC() }
	if err := service.Disable(context.Background(), "unused-id"); err != nil {
		t.Fatal(err)
	}
	if err := service.Revoke(context.Background(), "redeemed-id", "membership ended"); err != nil {
		t.Fatal(err)
	}
	if store.disabledID != "unused-id" || store.revokedID != "redeemed-id" || store.reason != "membership ended" {
		t.Fatalf("disable/revoke = %q/%q/%q", store.disabledID, store.revokedID, store.reason)
	}
}

func TestRevokeDisablesAnUnusedCode(t *testing.T) {
	store := &memoryStore{invalidateUnused: true}
	service := NewService(store, auth.NewService(nil, "secret", false))
	service.now = func() time.Time { return time.Unix(100, 0).UTC() }

	if err := service.Revoke(context.Background(), "unused-id", "sent to wrong person"); err != nil {
		t.Fatal(err)
	}
	if store.disabledID != "unused-id" || store.revokedID != "" {
		t.Fatalf("disable/revoke IDs = %q/%q", store.disabledID, store.revokedID)
	}
}

type memoryStore struct {
	hashes           []string
	codeHash         string
	passwordHash     string
	redeemErr        error
	disabledID       string
	revokedID        string
	reason           string
	unredeemable     bool
	redeemCalls      int
	invalidateUnused bool
}

func (s *memoryStore) CreateCodes(_ context.Context, label string, hashes []string) ([]StoredCode, error) {
	s.hashes = append([]string(nil), hashes...)
	codes := make([]StoredCode, len(hashes))
	for i, hash := range hashes {
		codes[i] = StoredCode{ID: string(rune('a' + i)), CodeHash: hash, BatchLabel: label, CreatedAt: time.Unix(int64(i+1), 0).UTC()}
	}
	return codes, nil
}

func (s *memoryStore) CanRedeem(_ context.Context, codeHash string) (bool, error) {
	s.codeHash = codeHash
	return !s.unredeemable, nil
}

func (s *memoryStore) Redeem(_ context.Context, codeHash string, email string, passwordHash string, _ auth.PreparedSession, _ time.Time) (auth.User, error) {
	s.redeemCalls++
	s.codeHash = codeHash
	s.passwordHash = passwordHash
	if s.redeemErr != nil {
		return auth.User{}, s.redeemErr
	}
	return auth.User{ID: "user-1", Email: email}, nil
}

func (s *memoryStore) Invalidate(_ context.Context, id string, reason string, _ time.Time) error {
	s.reason = reason
	if s.invalidateUnused {
		s.disabledID = id
	} else {
		s.revokedID = id
	}
	return nil
}

func (s *memoryStore) Disable(_ context.Context, id string, _ time.Time) error {
	s.disabledID = id
	return nil
}
