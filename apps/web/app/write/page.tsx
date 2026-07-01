"use client";

import { useEffect } from "react";
import Editor from "../editor";
import { AuthProvider, useAuth } from "../auth";
import { EntitlementsProvider } from "../entitlements";

export default function Write() {
  return <WriteShell />;
}

export function WriteShell() {
  return (
    <AuthProvider>
      <WriteGate />
    </AuthProvider>
  );
}

function WriteGate() {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [auth.loading, auth.user]);

  if (auth.loading) {
    return <main className="routeStatus">Loading</main>;
  }

  if (!auth.user) {
    return <main className="routeStatus">Redirecting to sign in</main>;
  }

  return (
    <EntitlementsProvider>
      <Editor />
    </EntitlementsProvider>
  );
}
