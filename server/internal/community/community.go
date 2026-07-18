package community

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

const invalidCodeMessage = "This code is invalid or has already been used."

var (
	ErrInvalidCode     = errors.New(invalidCodeMessage)
	ErrEmailTaken      = errors.New("email already exists")
	ErrCodeNotFound    = errors.New("community access code not found")
	ErrCodeNotRedeemed = errors.New("community access code has not been redeemed")
)

type Code struct {
	ID         string    `json:"id"`
	Code       string    `json:"code"`
	BatchLabel string    `json:"batchLabel"`
	CreatedAt  time.Time `json:"createdAt"`
}

type StoredCode struct {
	ID         string
	CodeHash   string
	BatchLabel string
	CreatedAt  time.Time
}

type Store interface {
	CreateCodes(ctx context.Context, label string, hashes []string) ([]StoredCode, error)
	Redeem(ctx context.Context, codeHash string, email string, passwordHash string, session auth.PreparedSession, now time.Time) (auth.User, error)
	Disable(ctx context.Context, id string, now time.Time) error
	Revoke(ctx context.Context, id string, reason string, now time.Time) error
}

type Service struct {
	store Store
	auth  *auth.Service
	now   func() time.Time
}

func NewService(store Store, authService *auth.Service) *Service {
	return &Service{store: store, auth: authService, now: time.Now}
}

func (s *Service) Generate(ctx context.Context, label string, count int) ([]Code, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return nil, errors.New("batch label is required")
	}
	if count < 1 || count > 100 {
		return nil, errors.New("count must be between 1 and 100")
	}

	plaintext := make([]string, count)
	hashes := make([]string, count)
	for i := range count {
		code, err := randomCode()
		if err != nil {
			return nil, err
		}
		plaintext[i] = code
		hashes[i] = HashCode(code)
	}
	stored, err := s.store.CreateCodes(ctx, label, hashes)
	if err != nil {
		return nil, err
	}
	if len(stored) != len(plaintext) {
		return nil, errors.New("stored code count did not match request")
	}
	codes := make([]Code, len(stored))
	for i, item := range stored {
		codes[i] = Code{ID: item.ID, Code: plaintext[i], BatchLabel: item.BatchLabel, CreatedAt: item.CreatedAt}
	}
	return codes, nil
}

func (s *Service) Redeem(ctx context.Context, code string, email string, password string) (auth.User, auth.PreparedSession, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return auth.User{}, auth.PreparedSession{}, errors.New("valid email is required")
	}
	if len(password) < 8 {
		return auth.User{}, auth.PreparedSession{}, errors.New("password must be at least 8 characters")
	}
	if NormalizeCode(code) == "" {
		return auth.User{}, auth.PreparedSession{}, ErrInvalidCode
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	session, err := s.auth.PrepareSession()
	if err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	user, err := s.store.Redeem(ctx, HashCode(code), email, string(passwordHash), session, s.now())
	if err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	return user, session, nil
}

func (s *Service) Disable(ctx context.Context, id string) error {
	return s.store.Disable(ctx, id, s.now())
}

func (s *Service) Revoke(ctx context.Context, id string, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return errors.New("revocation reason is required")
	}
	return s.store.Revoke(ctx, id, reason, s.now())
}

func NormalizeCode(code string) string {
	var normalized strings.Builder
	for _, char := range strings.ToUpper(strings.TrimSpace(code)) {
		if char == '-' || char == ' ' || char == '\t' || char == '\n' || char == '\r' {
			continue
		}
		normalized.WriteRune(char)
	}
	return normalized.String()
}

func HashCode(code string) string {
	sum := sha256.Sum256([]byte(NormalizeCode(code)))
	return hex.EncodeToString(sum[:])
}

func randomCode() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate community access code: %w", err)
	}
	raw := strings.ToUpper(hex.EncodeToString(bytes))
	parts := make([]string, 0, 9)
	parts = append(parts, "PASS")
	for i := 0; i < len(raw); i += 4 {
		parts = append(parts, raw[i:i+4])
	}
	return strings.Join(parts, "-"), nil
}

func InvalidCodeMessage() string {
	return invalidCodeMessage
}
