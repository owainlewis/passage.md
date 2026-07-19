"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "./auth";

export function sessionRouteKey(pathname: string | null) {
  if (!pathname) return "public";
  if (pathname === "/write" || pathname.startsWith("/write/")) return "/write";
  if (pathname === "/account") return "/account";
  if (pathname === "/admin") return "/admin";
  return "public";
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const routeKey = sessionRouteKey(pathname);
  const [verifiedRouteKey, setVerifiedRouteKey] = useState(routeKey);
  const routeRevalidating = routeKey !== verifiedRouteKey;
  const markRouteVerified = useCallback(() => setVerifiedRouteKey(routeKey), [routeKey]);

  return (
    <AuthProvider routeRevalidating={routeRevalidating}>
      <SessionRevalidator
        markRouteVerified={markRouteVerified}
        routeRevalidating={routeRevalidating}
      />
      {children}
    </AuthProvider>
  );
}

function SessionRevalidator({
  markRouteVerified,
  routeRevalidating
}: {
  markRouteVerified: () => void;
  routeRevalidating: boolean;
}) {
  const { refreshAccount } = useAuth();

  useEffect(() => {
    if (!routeRevalidating) return;
    let cancelled = false;
    void refreshAccount({
      requireVerified: true,
      shouldCommitError: () => !cancelled
    })
      .then((applied) => {
        if (applied && !cancelled) markRouteVerified();
      })
      .catch(() => {
        if (!cancelled) markRouteVerified();
      });
    return () => {
      cancelled = true;
    };
  }, [markRouteVerified, refreshAccount, routeRevalidating]);

  useEffect(() => {
    const refresh = () => {
      if (!routeRevalidating) void refreshAccount().catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshAccount, routeRevalidating]);

  return null;
}
