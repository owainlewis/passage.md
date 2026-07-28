package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func TestStripeClientRetrievesSubscriptionSnapshot(t *testing.T) {
	periodEnd := time.Now().UTC().Add(30 * 24 * time.Hour).Truncate(time.Second)
	createdAt := time.Now().UTC().Add(-24 * time.Hour).Truncate(time.Second)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/subscriptions/sub_test" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if user, _, ok := r.BasicAuth(); !ok || user != "sk_test_123" {
			t.Fatal("missing Stripe basic auth")
		}
		_, _ = w.Write([]byte(`{
			"id":"sub_test",
			"customer":"cus_test",
			"created":` + strconv.FormatInt(createdAt.Unix(), 10) + `,
			"status":"active",
			"metadata":{"passage_user_id":"user-1"},
			"cancel_at_period_end":true,
			"items":{"data":[{
				"current_period_end":` + strconv.FormatInt(periodEnd.Unix(), 10) + `,
				"price":{"id":"price_test"}
			}]}
		}`))
	}))
	defer server.Close()

	client := NewStripeClient("sk_test_123", server.URL, server.Client())
	before := time.Now().UTC()
	snapshot, err := client.RetrieveSubscription(context.Background(), "sub_test")
	if err != nil {
		t.Fatal(err)
	}
	after := time.Now().UTC()
	if snapshot.ID != "sub_test" ||
		snapshot.CustomerID != "cus_test" ||
		snapshot.Status != "active" ||
		snapshot.PriceID != "price_test" ||
		snapshot.Metadata["passage_user_id"] != "user-1" ||
		!snapshot.CancelAtPeriodEnd ||
		snapshot.CreatedAt == nil ||
		!snapshot.CreatedAt.Equal(createdAt) ||
		snapshot.CurrentPeriodEnd == nil ||
		!snapshot.CurrentPeriodEnd.Equal(periodEnd) ||
		snapshot.RetrievedAt.Before(before) ||
		snapshot.RetrievedAt.After(after) {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	next, err := client.RetrieveSubscription(context.Background(), "sub_test")
	if err != nil {
		t.Fatal(err)
	}
	if !next.RetrievedAt.After(snapshot.RetrievedAt) {
		t.Fatalf("retrieval timestamps = %s then %s", snapshot.RetrievedAt, next.RetrievedAt)
	}
}

func TestCreateCustomerUsesStableUserIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/customers" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Idempotency-Key"); got != "passage-customer-80c9db756700f8c3fa26ad6c7ca10d124783eb87731b2eb522aeb376ec8ad0e4" {
			t.Fatalf("Idempotency-Key = %q", got)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if len(r.Form) != 0 {
			t.Fatalf("unlinked customer form = %v, want no personal data", r.Form)
		}
		writeStripeJSON(t, w, map[string]string{"id": "cus_test"})
	}))
	defer server.Close()

	client := NewStripeClient("sk_test", server.URL, server.Client())
	customerID, err := client.CreateCustomer(context.Background(), CustomerParams{
		Email:  "writer@example.com",
		UserID: "user-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if customerID != "cus_test" {
		t.Fatalf("customer ID = %q, want cus_test", customerID)
	}
}

func TestConfigureCustomerAddsPersonalDataAfterLinking(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/customers/cus_test" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if got := r.Form.Get("email"); got != "writer@example.com" {
			t.Fatalf("email = %q, want writer@example.com", got)
		}
		if got := r.Form.Get("metadata[passage_user_id]"); got != "user-1" {
			t.Fatalf("passage user ID = %q, want user-1", got)
		}
		writeStripeJSON(t, w, map[string]string{"id": "cus_test"})
	}))
	defer server.Close()

	client := NewStripeClient("sk_test", server.URL, server.Client())
	if err := client.ConfigureCustomer(context.Background(), "cus_test", CustomerParams{
		Email:  "writer@example.com",
		UserID: "user-1",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestNeutralizeUnsubscribedCustomerExpiresSessionsAndDeletesCustomer(t *testing.T) {
	var operations []string
	listRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, _, ok := r.BasicAuth()
		if !ok || username != "sk_test" {
			t.Errorf("basic auth = %q, %v", username, ok)
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/checkout/sessions":
			listRequests++
			operations = append(operations, "list")
			if got := r.URL.Query().Get("customer"); got != "cus_test" {
				t.Errorf("customer = %q, want cus_test", got)
			}
			if got := r.URL.Query().Get("status"); got != "open" {
				t.Errorf("status = %q, want open", got)
			}
			if got := r.URL.Query().Get("limit"); got != "100" {
				t.Errorf("limit = %q, want 100", got)
			}
			switch listRequests {
			case 1:
				writeStripeJSON(t, w, map[string]any{
					"data":     []map[string]string{{"id": "cs_open_1"}},
					"has_more": true,
				})
			case 2:
				if got := r.URL.Query().Get("starting_after"); got != "cs_open_1" {
					t.Errorf("starting_after = %q, want cs_open_1", got)
				}
				writeStripeJSON(t, w, map[string]any{
					"data":     []map[string]string{{"id": "cs_open_2"}},
					"has_more": false,
				})
			default:
				if got := r.URL.Query().Get("starting_after"); got != "" {
					t.Errorf("recheck starting_after = %q, want empty", got)
				}
				writeStripeJSON(t, w, map[string]any{"data": []any{}, "has_more": false})
			}
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions/cs_open_1/expire":
			operations = append(operations, "expire cs_open_1")
			writeStripeJSON(t, w, map[string]string{"id": "cs_open_1"})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions/cs_open_2/expire":
			operations = append(operations, "expire cs_open_2")
			writeStripeJSON(t, w, map[string]string{"id": "cs_open_2"})
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/customers/cus_test":
			operations = append(operations, "delete customer")
			writeStripeJSON(t, w, map[string]any{"id": "cus_test", "deleted": true})
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer server.Close()

	client := NewStripeClient("sk_test", server.URL, server.Client())
	if err := client.NeutralizeUnsubscribedCustomer(context.Background(), "cus_test"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"list",
		"list",
		"expire cs_open_1",
		"expire cs_open_2",
		"list",
		"delete customer",
	}
	if !reflect.DeepEqual(operations, want) {
		t.Fatalf("operations = %v, want %v", operations, want)
	}
}

func TestNeutralizeUnsubscribedCustomerStopsWhenExpiryFails(t *testing.T) {
	customerDeleted := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/checkout/sessions":
			writeStripeJSON(t, w, map[string]any{
				"data":     []map[string]string{{"id": "cs_open"}},
				"has_more": false,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions/cs_open/expire":
			w.WriteHeader(http.StatusBadGateway)
			writeStripeJSON(t, w, map[string]any{
				"error": map[string]string{"message": "expiry unavailable"},
			})
		case r.Method == http.MethodDelete:
			customerDeleted = true
			writeStripeJSON(t, w, map[string]any{"id": "cus_test", "deleted": true})
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer server.Close()

	client := NewStripeClient("sk_test", server.URL, server.Client())
	err := client.NeutralizeUnsubscribedCustomer(context.Background(), "cus_test")
	if err == nil || err.Error() != "stripe request failed: expiry unavailable" {
		t.Fatalf("error = %v, want Stripe expiry error", err)
	}
	if customerDeleted {
		t.Fatal("customer was deleted after Checkout session expiry failed")
	}
}

func TestNeutralizeUnsubscribedCustomerRequiresStripeConfiguration(t *testing.T) {
	client := NewStripeClient("", "", nil)
	err := client.NeutralizeUnsubscribedCustomer(context.Background(), "cus_test")
	if !errors.Is(err, ErrStripeConfig) {
		t.Fatalf("error = %v, want ErrStripeConfig", err)
	}
}

func TestNeutralizeUnsubscribedCustomerTreatsAlreadyDeletedCustomerAsComplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/checkout/sessions":
			writeStripeJSON(t, w, map[string]any{"data": []any{}, "has_more": false})
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/customers/cus_deleted":
			w.WriteHeader(http.StatusNotFound)
			writeStripeJSON(t, w, map[string]any{
				"error": map[string]string{
					"code":    "resource_missing",
					"message": "No such customer",
				},
			})
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.String())
			http.Error(w, `{"error":{"message":"unexpected request"}}`, http.StatusBadRequest)
		}
	}))
	defer server.Close()

	client := NewStripeClient("sk_test", server.URL, server.Client())
	if err := client.NeutralizeUnsubscribedCustomer(context.Background(), "cus_deleted"); err != nil {
		t.Fatalf("already deleted customer error = %v", err)
	}
}

func writeStripeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Error(err)
	}
}
