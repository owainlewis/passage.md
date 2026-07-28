package billing

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

var ErrStripeConfig = errors.New("stripe is not configured")

type StripeClient struct {
	secretKey       string
	baseURL         string
	client          *http.Client
	lastRetrievedAt atomic.Int64
}

type CustomerParams struct {
	Email  string
	UserID string
}

type CheckoutParams struct {
	CustomerID     string
	UserID         string
	MonthlyPriceID string
	SuccessURL     string
	CancelURL      string
}

type PortalParams struct {
	CustomerID string
	ReturnURL  string
}

type SubscriptionSnapshot struct {
	ID                string
	CustomerID        string
	CreatedAt         *time.Time
	Status            string
	PriceID           string
	CurrentPeriodEnd  *time.Time
	CancelAtPeriodEnd bool
	Metadata          map[string]string
	RetrievedAt       time.Time
}

func NewStripeClient(secretKey string, baseURL string, client *http.Client) *StripeClient {
	if baseURL == "" {
		baseURL = "https://api.stripe.com"
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &StripeClient{
		secretKey: secretKey,
		baseURL:   strings.TrimRight(baseURL, "/"),
		client:    client,
	}
}

func (c *StripeClient) CreateCustomer(ctx context.Context, params CustomerParams) (string, error) {
	idempotencyKey := sha256.Sum256([]byte("passage-customer:" + params.UserID))
	var out stripeObject
	if err := c.postFormWithIdempotencyKey(ctx, "/v1/customers", url.Values{}, fmt.Sprintf("passage-customer-%x", idempotencyKey[:]), &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

func (c *StripeClient) ConfigureCustomer(ctx context.Context, customerID string, params CustomerParams) error {
	values := url.Values{}
	values.Set("email", params.Email)
	values.Set("metadata[passage_user_id]", params.UserID)
	var out stripeObject
	return c.postForm(ctx, "/v1/customers/"+url.PathEscape(customerID), values, &out)
}

func (c *StripeClient) CreateCheckoutSession(ctx context.Context, params CheckoutParams) (string, error) {
	values := url.Values{}
	values.Set("mode", "subscription")
	values.Set("customer", params.CustomerID)
	values.Set("client_reference_id", params.UserID)
	values.Set("line_items[0][price]", params.MonthlyPriceID)
	values.Set("line_items[0][quantity]", "1")
	values.Set("success_url", params.SuccessURL)
	values.Set("cancel_url", params.CancelURL)
	values.Set("metadata[passage_user_id]", params.UserID)
	values.Set("subscription_data[metadata][passage_user_id]", params.UserID)
	var out stripeObject
	if err := c.postForm(ctx, "/v1/checkout/sessions", values, &out); err != nil {
		return "", err
	}
	return out.URL, nil
}

func (c *StripeClient) CreatePortalSession(ctx context.Context, params PortalParams) (string, error) {
	values := url.Values{}
	values.Set("customer", params.CustomerID)
	values.Set("return_url", params.ReturnURL)
	var out stripeObject
	if err := c.postForm(ctx, "/v1/billing_portal/sessions", values, &out); err != nil {
		return "", err
	}
	return out.URL, nil
}

func (c *StripeClient) RetrieveSubscription(ctx context.Context, subscriptionID string) (SubscriptionSnapshot, error) {
	var out stripeSubscription
	retrievedAt, err := c.get(ctx, "/v1/subscriptions/"+url.PathEscape(subscriptionID), &out)
	if err != nil {
		return SubscriptionSnapshot{}, err
	}
	var periodEnd *time.Time
	if value := out.currentPeriodEnd(); value > 0 {
		parsed := time.Unix(value, 0).UTC()
		periodEnd = &parsed
	}
	var createdAt *time.Time
	if out.Created > 0 {
		parsed := time.Unix(out.Created, 0).UTC()
		createdAt = &parsed
	}
	return SubscriptionSnapshot{
		ID:                out.ID,
		CustomerID:        out.Customer,
		CreatedAt:         createdAt,
		Status:            out.Status,
		PriceID:           out.priceID(),
		CurrentPeriodEnd:  periodEnd,
		CancelAtPeriodEnd: out.scheduledForCancellation(),
		Metadata:          out.Metadata,
		RetrievedAt:       retrievedAt,
	}, nil
}

func (c *StripeClient) get(ctx context.Context, path string, target any) (time.Time, error) {
	if err := c.request(ctx, http.MethodGet, path, nil, target); err != nil {
		return time.Time{}, err
	}
	return c.nextRetrievedAt(), nil
}

func (c *StripeClient) nextRetrievedAt() time.Time {
	candidate := time.Now().UTC().UnixNano()
	for {
		previous := c.lastRetrievedAt.Load()
		if candidate <= previous {
			candidate = previous + 1
		}
		if c.lastRetrievedAt.CompareAndSwap(previous, candidate) {
			return time.Unix(0, candidate).UTC()
		}
	}
}

func (c *StripeClient) NeutralizeUnsubscribedCustomer(ctx context.Context, customerID string) error {
	if strings.TrimSpace(customerID) == "" {
		return errors.New("Stripe customer ID is required")
	}
	for attempt := 0; attempt < 10; attempt++ {
		sessions, err := c.listOpenCheckoutSessions(ctx, customerID)
		if err != nil {
			return err
		}
		if len(sessions) == 0 {
			var deleted stripeObject
			err := c.request(ctx, http.MethodDelete, "/v1/customers/"+url.PathEscape(customerID), nil, &deleted)
			if stripeResourceMissing(err) {
				return nil
			}
			return err
		}
		for _, session := range sessions {
			var expired stripeObject
			if err := c.postForm(ctx, "/v1/checkout/sessions/"+url.PathEscape(session.ID)+"/expire", url.Values{}, &expired); err != nil {
				return err
			}
		}
	}
	return errors.New("Stripe Checkout sessions remained open after repeated expiry")
}

func (c *StripeClient) listOpenCheckoutSessions(ctx context.Context, customerID string) ([]stripeObject, error) {
	values := url.Values{}
	values.Set("customer", customerID)
	values.Set("status", "open")
	values.Set("limit", "100")
	var sessions []stripeObject
	for {
		var out stripeList
		path := "/v1/checkout/sessions?" + values.Encode()
		if err := c.request(ctx, http.MethodGet, path, nil, &out); err != nil {
			if stripeResourceMissing(err) {
				return nil, nil
			}
			return nil, err
		}
		sessions = append(sessions, out.Data...)
		if !out.HasMore {
			return sessions, nil
		}
		if len(out.Data) == 0 {
			return nil, errors.New("Stripe returned an empty Checkout session page with has_more set")
		}
		values.Set("starting_after", out.Data[len(out.Data)-1].ID)
	}
}

func (c *StripeClient) postForm(ctx context.Context, path string, values url.Values, target *stripeObject) error {
	return c.request(ctx, http.MethodPost, path, values, target)
}

func (c *StripeClient) postFormWithIdempotencyKey(ctx context.Context, path string, values url.Values, key string, target *stripeObject) error {
	return c.requestWithIdempotencyKey(ctx, http.MethodPost, path, values, key, target)
}

func (c *StripeClient) request(ctx context.Context, method string, path string, values url.Values, target any) error {
	return c.requestWithIdempotencyKey(ctx, method, path, values, "", target)
}

func (c *StripeClient) requestWithIdempotencyKey(ctx context.Context, method string, path string, values url.Values, idempotencyKey string, target any) error {
	if c == nil || c.secretKey == "" {
		return ErrStripeConfig
	}
	var body io.Reader
	if values != nil {
		body = strings.NewReader(values.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.secretKey, "")
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	res, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var failure stripeObject
		if err := json.NewDecoder(res.Body).Decode(&failure); err == nil && failure.Error != nil && failure.Error.Message != "" {
			return &stripeRequestError{
				status:  res.StatusCode,
				code:    failure.Error.Code,
				message: failure.Error.Message,
			}
		}
		return &stripeRequestError{status: res.StatusCode}
	}
	return json.NewDecoder(res.Body).Decode(target)
}

type stripeObject struct {
	ID    string       `json:"id"`
	URL   string       `json:"url"`
	Error *stripeError `json:"error"`
}

type stripeList struct {
	Data    []stripeObject `json:"data"`
	HasMore bool           `json:"has_more"`
}

type stripeError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

type stripeRequestError struct {
	status  int
	code    string
	message string
}

func (e *stripeRequestError) Error() string {
	if e.message != "" {
		return fmt.Sprintf("stripe request failed: %s", e.message)
	}
	return fmt.Sprintf("stripe request failed with status %d", e.status)
}

func stripeResourceMissing(err error) bool {
	var stripeErr *stripeRequestError
	return errors.As(err, &stripeErr) && stripeErr.code == "resource_missing"
}

type stripeSubscription struct {
	ID                string            `json:"id"`
	Customer          string            `json:"customer"`
	Created           int64             `json:"created"`
	Status            string            `json:"status"`
	CurrentPeriodEnd  int64             `json:"current_period_end"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	CancelAt          int64             `json:"cancel_at"`
	EndedAt           int64             `json:"ended_at"`
	Metadata          map[string]string `json:"metadata"`
	Items             struct {
		Data []struct {
			CurrentPeriodEnd int64 `json:"current_period_end"`
			Price            struct {
				ID string `json:"id"`
			} `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

func (s stripeSubscription) priceID() string {
	if len(s.Items.Data) == 0 {
		return ""
	}
	return s.Items.Data[0].Price.ID
}

func (s stripeSubscription) currentPeriodEnd() int64 {
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

func (s stripeSubscription) scheduledForCancellation() bool {
	return s.CancelAtPeriodEnd || (s.CancelAt > 0 && s.EndedAt == 0 && s.Status != "canceled")
}
