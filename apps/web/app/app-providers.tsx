"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "./auth";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SessionRevalidator />
      {children}
    </AuthProvider>
  );
}

function SessionRevalidator() {
  const pathname = usePathname();
  const { refreshAccount } = useAuth();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    void refreshAccount().catch(() => undefined);
  }, [pathname, refreshAccount]);

  useEffect(() => {
    const refresh = () => void refreshAccount().catch(() => undefined);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshAccount]);

  return null;
}
