"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type User = {
  id: string;
  email: string;
};

export type Account = {
  plan: "free" | "pro";
  source: string;
  limits: {
    maxSavedDocs: number;
  };
  usage: {
    savedDocs: number;
  };
  subscription: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    status?: string;
    priceId?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
  };
};

type AuthValue = {
  user: User | null;
  account: Account | null;
  loading: boolean;
  refreshAccount: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  completeMagicLink: (token: string) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/v1/me", { credentials: "include" });
    if (!res.ok) return;
    const body = (await res.json()) as { authenticated?: boolean; user?: User; account?: Account };
    setUser(body.authenticated ? body.user ?? null : null);
    setAccount(body.authenticated ? body.account ?? null : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/me", { credentials: "include" });
        if (!res.ok) return;
        const body = (await res.json()) as { authenticated?: boolean; user?: User; account?: Account };
        if (!cancelled) {
          setUser(body.authenticated ? body.user ?? null : null);
          setAccount(body.authenticated ? body.account ?? null : null);
        }
      } catch {
        // Treat auth lookup failures as signed out.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

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
    setAccount(body.account ?? null);
    void loadMe().catch(() => undefined);
  }, [loadMe]);

  const signIn = useCallback(
    (email: string, password: string) => submitCredentials("/api/v1/auth/login", email, password),
    [submitCredentials]
  );

  const requestMagicLink = useCallback(async (email: string) => {
    const res = await fetch("/api/v1/auth/magic-link", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : "Magic link request failed");
    }
  }, []);

  const completeMagicLink = useCallback(async (token: string) => {
    const res = await fetch("/api/v1/auth/magic-link/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.error === "string" ? body.error : "Magic link sign-in failed");
    }
    setUser(body.user ?? null);
    setAccount(body.account ?? null);
    void loadMe().catch(() => undefined);
  }, [loadMe]);

  const signOut = useCallback(async () => {
    const res = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : "Sign out failed");
    }
    setUser(null);
    setAccount(null);
  }, []);

  const refreshAccount = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const value = useMemo(
    () => ({ user, account, loading, refreshAccount, signIn, signOut, requestMagicLink, completeMagicLink }),
    [user, account, loading, refreshAccount, signIn, signOut, requestMagicLink, completeMagicLink]
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}
