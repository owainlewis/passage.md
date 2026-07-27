package httpx

import (
	"net/http/httptest"
	"testing"
)

func TestClientIPResolverIgnoresForwardingFromUntrustedPeer(t *testing.T) {
	resolver := NewClientIPResolver([]string{"10.0.0.0/8"}, 2)
	request := httptest.NewRequest("GET", "/", nil)
	request.RemoteAddr = "192.0.2.10:1234"
	request.Header.Set("X-Forwarded-For", "198.51.100.20, 203.0.113.30")

	if got := resolver.Resolve(request); got != "192.0.2.10" {
		t.Fatalf("Resolve = %q, want peer address", got)
	}
}

func TestClientIPResolverUsesConfiguredCloudRunProxyHops(t *testing.T) {
	resolver := NewClientIPResolver([]string{"169.254.0.0/16"}, 2)
	request := httptest.NewRequest("GET", "/", nil)
	request.RemoteAddr = "169.254.1.1:8080"
	request.Header.Set("X-Forwarded-For", "192.0.2.99, 198.51.100.20, 203.0.113.30")

	if got := resolver.Resolve(request); got != "198.51.100.20" {
		t.Fatalf("Resolve = %q, want client address", got)
	}
}

func TestClientIPResolverFallsBackWhenForwardingChainIsTooShort(t *testing.T) {
	resolver := NewClientIPResolver([]string{"10.0.0.0/8"}, 2)
	request := httptest.NewRequest("GET", "/", nil)
	request.RemoteAddr = "10.0.0.2:8080"
	request.Header.Set("X-Forwarded-For", "198.51.100.20")

	if got := resolver.Resolve(request); got != "10.0.0.2" {
		t.Fatalf("Resolve = %q, want peer address", got)
	}
}

func TestClientIPResolverDoesNotShiftAcrossMalformedForwardingEntry(t *testing.T) {
	resolver := NewClientIPResolver([]string{"10.0.0.0/8"}, 2)
	request := httptest.NewRequest("GET", "/", nil)
	request.RemoteAddr = "10.0.0.2:8080"
	request.Header.Set("X-Forwarded-For", "192.0.2.99, invalid, 203.0.113.30")

	if got := resolver.Resolve(request); got != "10.0.0.2" {
		t.Fatalf("Resolve = %q, want peer address", got)
	}
}
