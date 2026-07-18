"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "../auth";
import { Brand } from "../brand";

type Referral = { ref: string; code: string; name: string };

export default function Signup() {
  return (
    <AuthProvider>
      <SignupForm />
    </AuthProvider>
  );
}

function SignupForm() {
  const auth = useAuth();
  const [referral, setReferral] = useState<Referral | null>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const capturedCredentials = useRef<{ ref: string; code: string } | null | undefined>(undefined);

  useEffect(() => {
    if (!auth.loading && auth.user) {
      window.location.replace("/write");
    }
  }, [auth.loading, auth.user]);

  useEffect(() => {
    if (capturedCredentials.current === undefined) {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref")?.trim() ?? "";
      const code = params.get("code")?.trim() ?? "";
      capturedCredentials.current = ref && code ? { ref, code } : null;
      window.history.replaceState({}, "", "/signup");
    }

    if (!capturedCredentials.current) {
      setReferral(null);
      return;
    }
    const { ref, code } = capturedCredentials.current;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/v1/auth/referral/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref, code })
        });
        const body = (await response.json().catch(() => ({}))) as { name?: string };
        if (!cancelled) {
          setReferral(response.ok && body.name ? { ref, code, name: body.name } : null);
        }
      } catch {
        if (!cancelled) setReferral(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!referral) return;
    setError("");
    setSubmitting(true);
    try {
      await auth.referralSignup(referral.ref, referral.code, email, password);
      window.location.replace("/write");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account could not be created");
      setSubmitting(false);
    }
  }

  return (
    <main className="loginPage">
      <header className="loginNav">
        <Brand href="/" />
        <Link href="/login">Sign in</Link>
      </header>
      {referral === undefined ? (
        <section className="loginShell" aria-label="Checking referral">
          <p className="betaLabel">Community access</p>
          <h1>Checking your invitation</h1>
        </section>
      ) : referral === null ? (
        <section className="loginShell" aria-labelledby="signup-closed-title">
          <p className="betaLabel">Closed beta</p>
          <h1 id="signup-closed-title">Passage is not open for signup yet</h1>
          <p className="loginCopy">
            If your community includes Passage Pro, use the private signup link they shared with you.
          </p>
          <Link className="btnPrimary loginSubmit" href="/login">
            Sign in
          </Link>
        </section>
      ) : (
        <section className="loginShell" aria-labelledby="signup-title">
          <p className="betaLabel">{referral.name}</p>
          <h1 id="signup-title">Create your Passage account</h1>
          <p className="loginCopy">
            Passage Pro is included with your community membership. No card or checkout is required.
          </p>
          <form className="loginForm" onSubmit={submit}>
            <label>
              <span>Email</span>
              <input
                className="authInput"
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                className="authInput"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            {error && <p className="authError">{error}</p>}
            <button className="btnPrimary loginSubmit" type="submit" disabled={auth.loading || submitting}>
              {submitting ? "Creating account" : "Create account"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
