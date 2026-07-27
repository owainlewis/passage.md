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

	snapshot, err := NewStripeClient("sk_test_123", server.URL, server.Client()).RetrieveSubscription(context.Background(), "sub_test")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ID != "sub_test" ||
		snapshot.CustomerID != "cus_test" ||
		snapshot.Status != "active" ||
		snapshot.PriceID != "price_test" ||
		snapshot.Metadata["passage_user_id"] != "user-1" ||
		!snapshot.CancelAtPeriodEnd ||
		snapshot.CurrentPeriodEnd == nil ||
		!snapshot.CurrentPeriodEnd.Equal(periodEnd) {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}
