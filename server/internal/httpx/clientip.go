package httpx

import (
	"net/http"
	"net/netip"
	"strings"
)

type ClientIPResolver struct {
	trustedProxies []netip.Prefix
	forwardedHops  int
}

func NewClientIPResolver(trustedCIDRs []string, forwardedHops int) ClientIPResolver {
	trustedProxies := make([]netip.Prefix, 0, len(trustedCIDRs))
	for _, cidr := range trustedCIDRs {
		if prefix, err := netip.ParsePrefix(cidr); err == nil {
			trustedProxies = append(trustedProxies, prefix)
		}
	}
	return ClientIPResolver{trustedProxies: trustedProxies, forwardedHops: forwardedHops}
}

func (r ClientIPResolver) Resolve(request *http.Request) string {
	peer, ok := remoteIP(request.RemoteAddr)
	if !ok {
		return "unknown"
	}
	if r.forwardedHops <= 0 || !r.isTrusted(peer) {
		return peer.String()
	}

	forwarded := strings.Split(request.Header.Get("X-Forwarded-For"), ",")
	if len(forwarded) < r.forwardedHops {
		return peer.String()
	}
	client, err := netip.ParseAddr(strings.TrimSpace(forwarded[len(forwarded)-r.forwardedHops]))
	if err != nil {
		return peer.String()
	}
	return client.Unmap().String()
}

func (r ClientIPResolver) isTrusted(addr netip.Addr) bool {
	for _, prefix := range r.trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func remoteIP(value string) (netip.Addr, bool) {
	value = strings.TrimSpace(value)
	if addrPort, err := netip.ParseAddrPort(value); err == nil {
		return addrPort.Addr().Unmap(), true
	}
	if addr, err := netip.ParseAddr(value); err == nil {
		return addr.Unmap(), true
	}
	return netip.Addr{}, false
}
