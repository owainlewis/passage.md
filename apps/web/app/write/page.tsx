"use client";

import { useEffect } from "react";
import Editor from "../editor";
import { AuthBoundary, RoutePending, SessionError, useAuth } from "../auth";
import { EntitlementsProvider } from "../entitlements";

export default function Write() {
  return <WriteShell />;
}

export function WriteShell() {
  return (
    <AuthBoundary>
      <WriteGate />
    </AuthBoundary>
  );
}

function WriteGate() {
  const { loading, refreshAccount, routeRevalidating, sessionStatus, user } = useAuth();

  useEffect(() => {
    if (routeRevalidating) return;
    if (!loading && !user && sessionStatus === "unknown") {
      void refreshAccount().catch(() => undefined);
    } else if (!loading && !user && sessionStatus === "anonymous") {
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [loading, refreshAccount, routeRevalidating, sessionStatus, user]);

  if (loading || routeRevalidating || sessionStatus === "unknown") {
    return <RoutePending />;
  }

  if (sessionStatus === "error") {
    return <SessionError onRetry={() => void refreshAccount().catch(() => undefined)} />;
  }

  if (!user) {
    return <RoutePending label="Redirecting to sign in" />;
  }

  return (
    <EntitlementsProvider>
      <Editor />
    </EntitlementsProvider>
  );
}
