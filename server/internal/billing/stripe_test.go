package billing

import (
	"context"
	"net/http"
	"net/http/httptest"
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
