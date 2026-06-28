"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type User = {
  id: string;
  email: string;
};

type AuthValue = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/me", { credentials: "include" });
        if (!res.ok) return;
        const body = (await res.json()) as { authenticated?: boolean; user?: User };
        if (!cancelled) setUser(body.authenticated ? body.user ?? null : null);
      } catch {
        // The anonymous editor still works when no API server is available.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitCredentials = useCallback(async (path: string, email: string, password: string) => {
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.error === "string" ? body.error : "Authentication failed");
    }
    setUser(body.user ?? null);
  }, []);

  const signIn = useCallback(
    (email: string, password: string) => submitCredentials("/api/v1/auth/login", email, password),
    [submitCredentials]
  );

  const register = useCallback(
    (email: string, password: string) => submitCredentials("/api/v1/auth/register", email, password),
    [submitCredentials]
  );

  const signOut = useCallback(async () => {
    const res = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : "Sign out failed");
    }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, register, signOut }), [user, loading, signIn, register, signOut]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}
