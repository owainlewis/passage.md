"use client";

import { useEffect } from "react";
import Editor from "../editor";
import { AuthBoundary, RoutePending, useAuth } from "../auth";
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
  const { loading, refreshAccount, sessionStatus, user } = useAuth();

  useEffect(() => {
    if (!loading && !user && sessionStatus === "unknown") {
      void refreshAccount().catch(() => undefined);
    } else if (!loading && !user && sessionStatus === "anonymous") {
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [loading, refreshAccount, sessionStatus, user]);

  if (loading || sessionStatus === "unknown") {
    return <RoutePending />;
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
