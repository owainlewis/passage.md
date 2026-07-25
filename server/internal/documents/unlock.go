package documents

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	htmltemplate "html/template"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

const (
	unlockCookiePrefix = "passage_unlock_"
	unlockCookiePath   = "/d/"
	unlockLifetime     = 12 * time.Hour
	unlockWindow       = 15 * time.Minute
	unlockLimit        = 10
	// bcrypt rejects anything over 72 bytes outright, so cap at its limit rather
	// than letting a long passphrase fall through to a 500.
	maxSharePassword = 72
	minSharePassword = 6
	// Generous next to a 72 byte password, small enough to be uninteresting.
	maxUnlockRequestBytes = 4096
)

// unlockCookieName scopes the grant to one document. Public IDs are URL-safe
// base64 or hex, so every character is legal in a cookie name.
func unlockCookieName(publicID string) string {
	return unlockCookiePrefix + publicID
}

// unlockSignature binds a grant to the document, the current password, and an
// expiry. Including a fingerprint of the password hash means changing or
// removing the password invalidates every cookie already handed out.
func (h *Handler) unlockSignature(publicID string, passwordHash string, expiry int64) string {
	fingerprint := sha256.Sum256([]byte(passwordHash))
	mac := hmac.New(sha256.New, h.secret)
	mac.Write([]byte("unlock:"))
	mac.Write([]byte(publicID))
	mac.Write([]byte(":"))
	mac.Write(fingerprint[:])
	mac.Write([]byte(":"))
	mac.Write([]byte(strconv.FormatInt(expiry, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (h *Handler) issueUnlockCookie(w http.ResponseWriter, doc Document) {
	expiry := h.now().Add(unlockLifetime).Unix()
	http.SetCookie(w, &http.Cookie{
		Name:     unlockCookieName(doc.PublicID),
		Value:    strconv.FormatInt(expiry, 10) + "." + h.unlockSignature(doc.PublicID, doc.SharePasswordHash, expiry),
		Path:     unlockCookiePath,
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) hasUnlockCookie(r *http.Request, doc Document) bool {
	cookie, err := r.Cookie(unlockCookieName(doc.PublicID))
	if err != nil {
		return false
	}
	rawExpiry, signature, ok := strings.Cut(cookie.Value, ".")
	if !ok {
		return false
	}
	expiry, err := strconv.ParseInt(rawExpiry, 10, 64)
	if err != nil || h.now().Unix() >= expiry {
		return false
	}
	expected := h.unlockSignature(doc.PublicID, doc.SharePasswordHash, expiry)
	return hmac.Equal([]byte(expected), []byte(signature))
}

func clearUnlockCookie(w http.ResponseWriter, publicID string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     unlockCookieName(publicID),
		Value:    "",
		Path:     unlockCookiePath,
		HttpOnly: true,
		Secure:   secure,
		MaxAge:   -1,
	})
}

func hashKey(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// clientIP mirrors the auth package. Behind a trusted proxy the last hop is the
// proxy itself, so the second-to-last entry is the real client.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		var forwarded []netip.Addr
		for _, part := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
			if addr, err := netip.ParseAddr(strings.TrimSpace(part)); err == nil {
				forwarded = append(forwarded, addr.Unmap())
			}
		}
		if len(forwarded) >= 2 {
			return forwarded[len(forwarded)-2].String()
		}
	}
	host := strings.TrimSpace(r.RemoteAddr)
	if addrPort, err := netip.ParseAddrPort(host); err == nil {
		return addrPort.Addr().Unmap().String()
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Unmap().String()
	}
	return "unknown"
}

// unlockTemplate deliberately carries no document content, not even the title.
// The inline script reads the "#k=" fragment, which browsers never send to the
// server, so a shared link can unlock itself without the key touching any log.
var unlockTemplate = htmltemplate.Must(htmltemplate.New("unlock").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Protected document</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light;
      --bg: #fbfbf8;
      --ink: #1b1a17;
      --muted: #8c897f;
      --hairline: #e8e6dd;
      --accent: #2c6b60;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main {
      width: 100%;
      max-width: 22rem;
      text-align: center;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0 0 8px;
    }
    p {
      margin: 0 0 24px;
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.6;
    }
    form { display: flex; flex-direction: column; gap: 10px; }
    input {
      width: 100%;
      padding: 11px 13px;
      font: inherit;
      font-size: 1rem;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--hairline);
      border-radius: 8px;
    }
    input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button {
      padding: 11px 13px;
      font: inherit;
      font-size: 0.95rem;
      color: #fff;
      background: var(--accent);
      border: 0;
      border-radius: 8px;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: default; }
    .error {
      margin: 14px 0 0;
      color: #a3372c;
      font-size: 0.9rem;
      min-height: 1.2em;
    }
  </style>
</head>
<body>
  <main>
    <h1>This document is protected</h1>
    <p>Enter the password to read it.</p>
    <form id="unlockForm" method="post" action="{{ .UnlockPath }}">
      <input
        id="password"
        type="password"
        name="password"
        autocomplete="current-password"
        placeholder="Password"
        aria-label="Password"
        required
        autofocus
      >
      <button type="submit">Unlock</button>
    </form>
    <p class="error" id="error" role="alert">{{ .Error }}</p>
  </main>
  <script>
    (function () {
      var form = document.getElementById("unlockForm");
      var input = document.getElementById("password");
      var error = document.getElementById("error");
      var button = form.querySelector("button");

      function submit(password) {
        error.textContent = "";
        button.disabled = true;
        fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: password })
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
            return;
          }
          return res.json().catch(function () { return {}; }).then(function (payload) {
            button.disabled = false;
            input.value = "";
            error.textContent = payload.error || "That password did not work.";
          });
        }).catch(function () {
          button.disabled = false;
          error.textContent = "Unlock failed. Check your connection and try again.";
        });
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submit(input.value);
      });

      function submitFragmentKey() {
        var key = new URLSearchParams(window.location.hash.slice(1)).get("k");
        if (!key) return;
        // Strip the key from the URL before doing anything else. The unlocked
        // document renders Mermaid from a third-party module, and anything
        // running in that page can read window.location.hash.
        history.replaceState(null, "", window.location.pathname + window.location.search);
        input.value = key;
        submit(key);
      }

      // Pasting a "#k=" link over an already-open unlock page changes only the
      // fragment, which does not reload the page. Listen so that still works.
      window.addEventListener("hashchange", submitFragmentKey);
      submitFragmentKey();
    })();
  </script>
</body>
</html>`))

func renderUnlockPage(publicID string, message string) ([]byte, error) {
	var page bytes.Buffer
	err := unlockTemplate.Execute(&page, struct {
		UnlockPath string
		Error      string
	}{
		UnlockPath: "/d/" + publicID + "/unlock",
		Error:      message,
	})
	return page.Bytes(), err
}
