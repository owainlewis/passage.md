"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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
  routeRevalidating: boolean;
  sessionStatus: "loading" | "authenticated" | "anonymous" | "unknown";
  refreshAccount: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  referralSignup: (ref: string, code: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  children,
  routeRevalidating = false
}: {
  children: React.ReactNode;
  routeRevalidating?: boolean;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionStatus, setSessionStatus] = useState<AuthValue["sessionStatus"]>("loading");
  const requestVersion = useRef(0);
  const authMutationsInFlight = useRef(0);

  const loadMe = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const res = await fetch("/api/v1/me", { credentials: "include" });
      if (!res.ok) throw new Error("Account could not be loaded");
      const body = (await res.json()) as { authenticated?: boolean; user?: User; account?: Account };
      if (version !== requestVersion.current) return;
      setUser(body.authenticated ? body.user ?? null : null);
      setAccount(body.authenticated ? body.account ?? null : null);
      setSessionStatus(body.authenticated ? "authenticated" : "anonymous");
    } catch (error) {
      if (version === requestVersion.current) {
        setSessionStatus((current) => current === "loading" ? "unknown" : current);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMe();
      } catch {
        // Keep a failed lookup distinct from a confirmed signed-out session.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const submitCredentials = useCallback(async (path: string, email: string, password: string) => {
    authMutationsInFlight.current += 1;
    requestVersion.current += 1;
    try {
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
      try {
        await loadMe();
      } catch {
        if (!body.user) throw new Error("Account could not be loaded");
        setUser(body.user);
        setAccount(body.account ?? null);
        setSessionStatus("authenticated");
      }
    } finally {
      authMutationsInFlight.current -= 1;
    }
  }, [loadMe]);

  const signIn = useCallback(
    (email: string, password: string) => submitCredentials("/api/v1/auth/login", email, password),
    [submitCredentials]
  );

  const referralSignup = useCallback(async (ref: string, code: string, email: string, password: string) => {
    authMutationsInFlight.current += 1;
    requestVersion.current += 1;
    try {
      const res = await fetch("/api/v1/auth/referral-signup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, code, email, password })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Account could not be created");
      }
      try {
        await loadMe();
      } catch {
        if (!body.user) throw new Error("Account could not be loaded");
        setUser(body.user);
        setAccount(body.account ?? null);
        setSessionStatus("authenticated");
      }
    } finally {
      authMutationsInFlight.current -= 1;
    }
  }, [loadMe]);

  const signOut = useCallback(async () => {
    authMutationsInFlight.current += 1;
    requestVersion.current += 1;
    try {
      const res = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Sign out failed");
      }
      requestVersion.current += 1;
      setUser(null);
      setAccount(null);
      setSessionStatus("anonymous");
    } finally {
      authMutationsInFlight.current -= 1;
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    if (authMutationsInFlight.current > 0) return;
    await loadMe();
  }, [loadMe]);

  const value = useMemo(
    () => ({ user, account, loading, routeRevalidating, sessionStatus, refreshAccount, signIn, referralSignup, signOut }),
    [user, account, loading, routeRevalidating, sessionStatus, refreshAccount, signIn, referralSignup, signOut]
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const value = useContext(AuthContext);
  if (value) return children;
  return <AuthProvider>{children}</AuthProvider>;
}

export function RoutePending({ label = "Loading" }: { label?: string }) {
  return <main className="routePending" role="status" aria-label={label} aria-live="polite" />;
}

export function PendingStatus({ label }: { label: string }) {
  return <div className="pendingStatus" role="status" aria-label={label} aria-live="polite" />;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}
