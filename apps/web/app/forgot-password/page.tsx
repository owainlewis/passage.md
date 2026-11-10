"use client";

import { FormEvent, useState } from "react";
import styles from "../auth.module.css";
import { AuthPage } from "../auth-page";
import paper from "../paper.module.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/password-reset/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Password reset could not be requested");
      setMessage(payload.message || "If an account exists for that email, a password reset link is on its way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset could not be requested");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage link={{ href: "/login", label: "Sign in" }}>
      <section className={styles.shell} aria-labelledby="forgot-password-title">
        <p className={styles.context}>Account recovery</p>
        <h1 className={styles.title} id="forgot-password-title">Reset your password</h1>
        <p className={styles.lead}>Enter your account email and we will send a reset link if the account exists.</p>
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
          {error && <p className={styles.notice} data-tone="error" role="alert">{error}</p>}
          {message && <p className={styles.notice} role="status">{message}</p>}
          <button className={`${paper.primaryButton} ${styles.submit}`} type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </section>
    </AuthPage>
  );
}
