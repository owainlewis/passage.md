// Feature flags gated by plan. This is the single place that maps a feature to
// the minimum plan that unlocks it. Today the plan is a local stand-in; once
// auth (#26) and Stripe (#29) land, the plan comes from server entitlements and
// the rest of this logic stays the same.

export type Plan = "free" | "pro";

export type Feature = "darkMode";

export const FEATURE_REQUIREMENTS: Record<Feature, Plan> = {
  darkMode: "free"
};

const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  pro: 1
};

export function planAllows(plan: Plan, feature: Feature): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[FEATURE_REQUIREMENTS[feature]];
}
