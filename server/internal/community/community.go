package community

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/owainlewis/passage.md/server/internal/auth"
	"github.com/owainlewis/passage.md/server/internal/policy"
	"golang.org/x/crypto/bcrypt"
)

const invalidReferralMessage = "This referral link is invalid or no longer active."

var (
	ErrInvalidReferral  = errors.New(invalidReferralMessage)
	ErrEmailTaken       = errors.New("email already exists")
	ErrReferralExists   = errors.New("community referral already exists")
	ErrReferralNotFound = errors.New("community referral not found")
	ErrGrantNotFound    = errors.New("community grant not found")
	ErrPolicyRequired   = errors.New("Terms and Privacy acceptance is required")
	referralSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	codeHashPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type Referral struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Name      string    `json:"name"`
	Code      string    `json:"code"`
	SignupURL string    `json:"signupUrl"`
	CreatedAt time.Time `json:"createdAt"`
}

type StoredReferral struct {
	ID        string
	Slug      string
	Name      string
	CodeHash  string
	CreatedAt time.Time
}

type Store interface {
	CreateReferral(ctx context.Context, slug string, name string, codeHash string) (StoredReferral, error)
	FindActiveReferral(ctx context.Context, slug string, codeHash string) (StoredReferral, error)
	Redeem(ctx context.Context, slug string, codeHash string, email string, passwordHash string, policyVersion string, session auth.PreparedSession, now time.Time) (auth.User, error)
	RotateReferral(ctx context.Context, id string, codeHash string, now time.Time) (StoredReferral, error)
	DisableReferral(ctx context.Context, id string, now time.Time) error
	DisableReferralBySlug(ctx context.Context, slug string, now time.Time) error
	RevokeGrant(ctx context.Context, email string, reason string, now time.Time) error
}

type Service struct {
	store        Store
	auth         *auth.Service
	now          func() time.Time
	hashPassword func(string) (string, error)
}

func NewService(store Store, authService *auth.Service) *Service {
	return &Service{
		store: store,
		auth:  authService,
		now:   time.Now,
		hashPassword: func(password string) (string, error) {
			hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
			return string(hash), err
		},
	}
}

func (s *Service) CreateReferral(ctx context.Context, slug string, name string) (Referral, error) {
	slug, name, err := validateReferralIdentity(slug, name)
	if err != nil {
		return Referral{}, err
	}
	code, err := randomCode()
	if err != nil {
		return Referral{}, err
	}
	stored, err := s.store.CreateReferral(ctx, slug, name, HashCode(code))
	if err != nil {
		return Referral{}, err
	}
	return referralWithCode(stored, code), nil
}

func (s *Service) CreateReferralFromCodeHash(ctx context.Context, slug string, name string, codeHash string) (StoredReferral, error) {
	slug, name, err := validateReferralIdentity(slug, name)
	if err != nil {
		return StoredReferral{}, err
	}
	if !codeHashPattern.MatchString(codeHash) {
		return StoredReferral{}, errors.New("referral code hash must be 64 lowercase hexadecimal characters")
	}
	return s.store.CreateReferral(ctx, slug, name, codeHash)
}

func (s *Service) RotateReferral(ctx context.Context, id string) (Referral, error) {
	if !validUUID(id) {
		return Referral{}, ErrReferralNotFound
	}
	code, err := randomCode()
	if err != nil {
		return Referral{}, err
	}
	stored, err := s.store.RotateReferral(ctx, id, HashCode(code), s.now())
	if err != nil {
		return Referral{}, err
	}
	return referralWithCode(stored, code), nil
}

func (s *Service) DisableReferral(ctx context.Context, id string) error {
	if !validUUID(id) {
		return ErrReferralNotFound
	}
	return s.store.DisableReferral(ctx, id, s.now())
}

func (s *Service) DisableReferralBySlug(ctx context.Context, slug string) error {
	slug = normalizeSlug(slug)
	if !referralSlugPattern.MatchString(slug) {
		return ErrReferralNotFound
	}
	return s.store.DisableReferralBySlug(ctx, slug, s.now())
}

func (s *Service) ValidateReferral(ctx context.Context, slug string, code string) (StoredReferral, error) {
	slug = normalizeSlug(slug)
	if !referralSlugPattern.MatchString(slug) || NormalizeCode(code) == "" {
		return StoredReferral{}, ErrInvalidReferral
	}
	referral, err := s.store.FindActiveReferral(ctx, slug, HashCode(code))
	if errors.Is(err, ErrReferralNotFound) {
		return StoredReferral{}, ErrInvalidReferral
	}
	return referral, err
}

func (s *Service) Redeem(ctx context.Context, slug string, code string, email string, password string, policyVersion string) (auth.User, auth.PreparedSession, error) {
	slug = normalizeSlug(slug)
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return auth.User{}, auth.PreparedSession{}, errors.New("valid email is required")
	}
	if len(password) < 8 {
		return auth.User{}, auth.PreparedSession{}, errors.New("password must be at least 8 characters")
	}
	if policyVersion != policy.CurrentVersion {
		return auth.User{}, auth.PreparedSession{}, ErrPolicyRequired
	}
	if _, err := s.ValidateReferral(ctx, slug, code); err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	codeHash := HashCode(code)
	passwordHash, err := s.hashPassword(password)
	if err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	session, err := s.auth.PrepareSession()
	if err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	user, err := s.store.Redeem(ctx, slug, codeHash, email, passwordHash, policyVersion, session, s.now())
	if err != nil {
		return auth.User{}, auth.PreparedSession{}, err
	}
	return user, session, nil
}

func (s *Service) RevokeGrant(ctx context.Context, email string, reason string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return errors.New("valid email is required")
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return errors.New("revocation reason is required")
	}
	return s.store.RevokeGrant(ctx, email, reason, s.now())
}

func referralWithCode(stored StoredReferral, code string) Referral {
	return Referral{
		ID: stored.ID, Slug: stored.Slug, Name: stored.Name, Code: code,
		SignupURL: "/signup#ref=" + stored.Slug + "&code=" + code,
		CreatedAt: stored.CreatedAt,
	}
}

func normalizeSlug(slug string) string {
	return strings.ToLower(strings.TrimSpace(slug))
}

func validateReferralIdentity(slug string, name string) (string, string, error) {
	slug = normalizeSlug(slug)
	name = strings.TrimSpace(name)
	if !referralSlugPattern.MatchString(slug) {
		return "", "", errors.New("referral slug must contain lowercase letters, numbers, and single hyphens")
	}
	if name == "" {
		return "", "", errors.New("referral name is required")
	}
	return slug, name, nil
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return false
			}
		}
	}
	return true
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
		return "", fmt.Errorf("generate community referral code: %w", err)
	}
	raw := strings.ToUpper(hex.EncodeToString(bytes))
	parts := []string{"PASS"}
	for i := 0; i < len(raw); i += 4 {
		parts = append(parts, raw[i:i+4])
	}
	return strings.Join(parts, "-"), nil
}

func InvalidReferralMessage() string {
	return invalidReferralMessage
}
