"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Brand } from "../brand";

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
    <main className="loginPage">
      <header className="loginNav">
        <Brand href="/" />
        <Link href="/login">Sign in</Link>
      </header>
      <section className="loginShell" aria-labelledby="forgot-password-title">
        <p className="betaLabel">Account recovery</p>
        <h1 id="forgot-password-title">Reset your password</h1>
        <p className="loginCopy">Enter your account email and we will send a reset link if the account exists.</p>
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
          {error && <p className="authError" role="alert">{error}</p>}
          {message && <p className="authSuccess" role="status">{message}</p>}
          <button className="btnPrimary loginSubmit" type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </section>
    </main>
  );
}
