package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrStripeConfig = errors.New("stripe is not configured")

type StripeClient struct {
	secretKey string
	baseURL   string
	client    *http.Client
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
	values := url.Values{}
	values.Set("email", params.Email)
	values.Set("metadata[passage_user_id]", params.UserID)
	var out stripeObject
	if err := c.postForm(ctx, "/v1/customers", values, &out); err != nil {
		return "", err
	}
	return out.ID, nil
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

func (c *StripeClient) postForm(ctx context.Context, path string, values url.Values, target *stripeObject) error {
	if c == nil || c.secretKey == "" {
		return ErrStripeConfig
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.secretKey, "")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	var out stripeObject
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		if out.Error != nil && out.Error.Message != "" {
			return fmt.Errorf("stripe request failed: %s", out.Error.Message)
		}
		return fmt.Errorf("stripe request failed with status %d", res.StatusCode)
	}
	*target = out
	return nil
}

type stripeObject struct {
	ID    string       `json:"id"`
	URL   string       `json:"url"`
	Error *stripeError `json:"error"`
}

type stripeError struct {
	Message string `json:"message"`
}
