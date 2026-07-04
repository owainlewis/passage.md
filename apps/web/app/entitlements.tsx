"use client";

import { createContext, useCallback, useContext } from "react";
import { useAuth } from "./auth";
import { type Feature, type Plan, planAllows } from "./features";

type EntitlementsValue = {
  plan: Plan;
  maxSavedDocs: number;
  can: (feature: Feature) => boolean;
};

const EntitlementsContext = createContext<EntitlementsValue | null>(null);

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const plan = auth.account?.plan ?? "free";
  const maxSavedDocs = auth.account?.limits.maxSavedDocs ?? 5;

  const can = useCallback((feature: Feature) => planAllows(plan, feature), [plan]);

  return <EntitlementsContext value={{ plan, maxSavedDocs, can }}>{children}</EntitlementsContext>;
}

export function useEntitlements(): EntitlementsValue {
  const value = useContext(EntitlementsContext);
  if (!value) {
    throw new Error("useEntitlements must be used within an EntitlementsProvider");
  }
  return value;
}
