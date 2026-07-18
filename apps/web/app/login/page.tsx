"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AuthProvider, useAuth } from "../auth";
import { Brand } from "../brand";

export default function Login() {
  return (
    <AuthProvider>
      <LoginForm />
    </AuthProvider>
  );
}

function LoginForm() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const next = loginNextPath();

  useEffect(() => {
    if (!auth.loading && auth.user) {
      window.location.replace(next);
    }
  }, [auth.loading, auth.user, next]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await auth.signIn(email, password);
      window.location.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  return (
    <main className="loginPage">
      <header className="loginNav">
        <Brand href="/" />
        <Link href="/">Home</Link>
      </header>
      <section className="loginShell" aria-labelledby="login-title">
        <p className="betaLabel">Closed beta</p>
        <h1 id="login-title">Sign in to passage.md</h1>
        <p className="loginCopy">Passage is invite-only while the hosted editor and billing are being finished.</p>
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
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="authError">{error}</p>}
            <button className="btnPrimary loginSubmit" type="submit" disabled={auth.loading}>
              {auth.loading ? "Checking" : "Sign in"}
            </button>
		</form>
      </section>
    </main>
  );
}

function loginNextPath() {
  if (typeof window === "undefined") return "/write";
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/write";
  return raw;
}
