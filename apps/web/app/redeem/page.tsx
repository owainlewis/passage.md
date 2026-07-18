"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AuthProvider, useAuth } from "../auth";
import { Brand } from "../brand";

export default function Redeem() {
  return (
    <AuthProvider>
      <RedeemForm />
    </AuthProvider>
  );
}

function RedeemForm() {
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!auth.loading && auth.user) {
      window.location.replace("/write");
    }
  }, [auth.loading, auth.user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await auth.redeem(code, email, password);
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
      <section className="loginShell" aria-labelledby="redeem-title">
        <p className="betaLabel">Community access</p>
        <h1 id="redeem-title">Create your Passage account</h1>
        <p className="loginCopy">This code includes Pro access at no cost. No payment method is required.</p>
        <form className="loginForm" onSubmit={submit}>
          <label>
            <span>Access code</span>
            <input
              className="authInput"
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
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
    </main>
  );
}
