"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthBoundary, useAuth } from "../auth";
import styles from "../auth.module.css";
import { AuthPage } from "../auth-page";
import paper from "../paper.module.css";

type Referral = { ref: string; code: string; name: string; policyVersion: string };

export default function Signup() {
  return (
    <AuthBoundary>
      <SignupForm />
    </AuthBoundary>
  );
}

function SignupForm() {
  const auth = useAuth();
  const [referral, setReferral] = useState<Referral | null>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const capturedCredentials = useRef<{ ref: string; code: string } | null | undefined>(undefined);

  useEffect(() => {
    if (!auth.loading && !auth.routeRevalidating && auth.user) {
      window.location.replace("/write");
    }
  }, [auth.loading, auth.routeRevalidating, auth.user]);

  useEffect(() => {
    if (capturedCredentials.current === undefined) {
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const ref = (fragment.get("ref") ?? query.get("ref"))?.trim() ?? "";
      const code = (fragment.get("code") ?? query.get("code"))?.trim() ?? "";
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
        const body = (await response.json().catch(() => ({}))) as {
          name?: string;
          policyVersion?: string;
        };
        if (!cancelled) {
          setReferral(
            response.ok && body.name && body.policyVersion
              ? { ref, code, name: body.name, policyVersion: body.policyVersion }
              : null
          );
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
    if (!referral && !auth.publicSignupEnabled) return;
    if (!acceptedPolicies) {
      setError("Terms and Privacy acceptance is required");
      return;
    }
    const acceptedPolicyVersion = referral?.policyVersion ?? auth.policyVersion;
    if (!acceptedPolicyVersion) {
      setError("Signup policy could not be loaded");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      if (referral) {
        await auth.referralSignup(
          referral.ref,
          referral.code,
          email,
          password,
          acceptedPolicyVersion
        );
      } else {
        await auth.signUp(email, password, acceptedPolicyVersion);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account could not be created");
      setSubmitting(false);
    }
  }

  return (
    <AuthPage link={{ href: "/login", label: "Sign in" }}>
      {referral === undefined || (referral === null && auth.loading) ? (
        <section className={styles.shell} aria-label="Checking referral">
          <p className={styles.context}>{referral === undefined ? "Community access" : "Signup"}</p>
          <h1 className={styles.title}>{referral === undefined ? "Checking your invitation" : "Checking availability"}</h1>
        </section>
      ) : referral === null && !auth.publicSignupEnabled ? (
        <section className={styles.shell} aria-labelledby="signup-closed-title">
          <p className={styles.context}>Launch preview</p>
          <h1 className={styles.title} id="signup-closed-title">Passage is not open for signup yet</h1>
          <p className={styles.lead}>
            If your community includes Passage Pro, use the private signup link they shared with you.
          </p>
          <Link className={`${paper.primaryButton} ${styles.submit}`} href="/login">
            Sign in
          </Link>
        </section>
      ) : (
        <section className={styles.shell} aria-labelledby="signup-title">
          <p className={styles.context}>{referral?.name ?? "Free account"}</p>
          <h1 className={styles.title} id="signup-title">Create your account</h1>
          <p className={styles.lead}>
            {referral
              ? "Passage Pro is included with your community membership. No card or checkout is required."
              : "Start free with five saved Markdown documents, preview, Mermaid, and dark mode. No card is required."}
          </p>
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.field}>
              <span>Email</span>
              <input
                className={styles.input}
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className={styles.field}>
              <span>Password</span>
              <input
                className={styles.input}
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={acceptedPolicies}
                onChange={(event) => setAcceptedPolicies(event.target.checked)}
                required
              />
              <span>
                I agree to the <Link href="/terms">Terms</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </span>
            </label>
            {error && <p className={styles.notice} data-tone="error" role="alert">{error}</p>}
            <button
              className={`${paper.primaryButton} ${styles.submit}`}
              type="submit"
              disabled={auth.loading || auth.routeRevalidating || submitting}
            >
              {submitting ? "Creating account" : "Create account"}
            </button>
          </form>
        </section>
      )}
    </AuthPage>
  );
}
