"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AuthBoundary, useAuth } from "../auth";
import styles from "../auth.module.css";
import { AuthPage } from "../auth-page";
import paper from "../paper.module.css";

export default function Login() {
  return (
    <AuthBoundary>
      <LoginForm />
    </AuthBoundary>
  );
}

function LoginForm() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const next = loginNextPath();

  useEffect(() => {
    if (!auth.loading && !auth.routeRevalidating && auth.user) {
      window.location.replace(next);
    }
  }, [auth.loading, auth.routeRevalidating, auth.user, next]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await auth.signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  return (
    <AuthPage link={{ href: "/", label: "Home" }}>
      <section className={styles.shell} aria-labelledby="login-title">
        <p className={styles.context}>{auth.publicSignupEnabled ? "Welcome back" : "Launch preview"}</p>
        <h1 className={styles.title} id="login-title">Sign in to Passage</h1>
        <p className={styles.lead}>
          {auth.publicSignupEnabled ? (
            <>
              New to Passage? <Link href="/signup">Create a free account</Link>.
            </>
          ) : (
            "Public signup is not open yet. Existing account holders can sign in."
          )}
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
                autoComplete="current-password"
                required
              />
            </label>
            <Link className={styles.aside} href="/forgot-password">
              Forgot your password?
            </Link>
            {error && <p className={styles.notice} data-tone="error" role="alert">{error}</p>}
            <button className={`${paper.primaryButton} ${styles.submit}`} type="submit" disabled={auth.loading || auth.routeRevalidating}>
              Sign in
            </button>
        </form>
      </section>
    </AuthPage>
  );
}

function loginNextPath() {
  if (typeof window === "undefined") return "/write";
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/write";
  return raw;
}
