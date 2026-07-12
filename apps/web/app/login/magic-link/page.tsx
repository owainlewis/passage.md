"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "../../auth";
import { Brand } from "../../brand";

export default function MagicLinkVerify() {
  return (
    <AuthProvider>
      <MagicLinkVerifyForm />
    </AuthProvider>
  );
}

function MagicLinkVerifyForm() {
  const auth = useAuth();
  const [error, setError] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = new URLSearchParams(window.location.search).get("token");
    const run = async () => {
      if (!token) {
        throw new Error("This sign-in link is missing a token.");
      }
      await auth.completeMagicLink(token);
      window.location.replace(magicLinkNextPath());
    };

    run().catch((err) => {
      setError(err instanceof Error ? err.message : "This sign-in link is invalid or has expired.");
    });
  }, [auth]);

  return (
    <main className="loginPage">
      <header className="loginNav">
        <Brand href="/" />
        <Link href="/">Home</Link>
      </header>
      <section className="loginShell" aria-labelledby="magic-link-title">
        <h1 id="magic-link-title">Signing you in</h1>
        {error ? (
          <>
            <p className="authError">{error}</p>
            <Link href="/login" className="btnPrimary loginSubmit">
              Back to sign in
            </Link>
          </>
        ) : (
          <p className="loginCopy">One moment while we verify your link.</p>
        )}
      </section>
    </main>
  );
}

function magicLinkNextPath() {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/write";
  return raw;
}
