"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "../auth.module.css";
import { AuthPage } from "../auth-page";
import paper from "../paper.module.css";

export default function ResetPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const resetToken = hash.get("token") || "";
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const timer = window.setTimeout(() => setToken(resetToken), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/password-reset/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Password could not be reset");
      setComplete(true);
      setToken("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password could not be reset");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage link={{ href: "/login", label: "Sign in" }}>
      <section className={styles.shell} aria-labelledby="reset-password-title">
        <p className={styles.context}>Account recovery</p>
        <h1 className={styles.title} id="reset-password-title">Choose a new password</h1>
        {complete ? (
          <p className={styles.notice} role="status">
            Password reset. <Link href="/login">Sign in with your new password.</Link>
          </p>
        ) : token === "" ? (
          <p className={styles.notice} data-tone="error" role="alert">
            This reset link is invalid or has expired. <Link href="/forgot-password">Request a new link.</Link>
          </p>
        ) : (
          <>
            <p className={styles.lead}>Use at least 8 characters. This reset link can only be used once.</p>
            <form className={styles.form} onSubmit={submit}>
              <label className={styles.field}>
                <span>New password</span>
                <input
                  className={styles.input}
                  type="password"
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  required
                />
              </label>
              {error && <p className={styles.notice} data-tone="error" role="alert">{error}</p>}
              <button className={`${paper.primaryButton} ${styles.submit}`} type="submit" disabled={submitting || token === null}>
                {submitting ? "Resetting…" : "Reset password"}
              </button>
            </form>
          </>
        )}
      </section>
    </AuthPage>
  );
}
