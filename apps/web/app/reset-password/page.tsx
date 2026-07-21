"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Brand } from "../brand";

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
    <main className="loginPage">
      <header className="loginNav">
        <Brand href="/" />
        <Link href="/login">Sign in</Link>
      </header>
      <section className="loginShell" aria-labelledby="reset-password-title">
        <p className="betaLabel">Account recovery</p>
        <h1 id="reset-password-title">Choose a new password</h1>
        {complete ? (
          <p className="authSuccess" role="status">
            Password reset. <Link href="/login">Sign in with your new password.</Link>
          </p>
        ) : token === "" ? (
          <p className="authError" role="alert">
            This reset link is invalid or has expired. <Link href="/forgot-password">Request a new link.</Link>
          </p>
        ) : (
          <>
            <p className="loginCopy">Use at least 8 characters. This reset link can only be used once.</p>
            <form className="loginForm" onSubmit={submit}>
              <label>
                <span>New password</span>
                <input
                  className="authInput"
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
              {error && <p className="authError" role="alert">{error}</p>}
              <button className="btnPrimary loginSubmit" type="submit" disabled={submitting || token === null}>
                {submitting ? "Resetting…" : "Reset password"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
