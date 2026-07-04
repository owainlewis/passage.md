export type Plan = "free" | "pro";

export type Feature =
  | "savedDocuments"
  | "markdownPreview"
  | "darkMode"
  | "shareLinks"
  | "rawMarkdownUrls"
  | "exportMarkdown"
  | "apiTokens"
  | "customThemes";

export const FEATURE_REQUIREMENTS: Record<Feature, Plan> = {
  savedDocuments: "free",
  markdownPreview: "free",
  darkMode: "free",
  shareLinks: "pro",
  rawMarkdownUrls: "pro",
  exportMarkdown: "pro",
  apiTokens: "pro",
  customThemes: "pro"
};

export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: ["5 saved documents", "Preview, Mermaid, and copy", "Light and dark mode"],
  pro: ["1,000 saved documents", "Share read-only links", "Export and raw .md URLs", "CLI and API for agents"]
};

const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  pro: 1
};

export function planAllows(plan: Plan, feature: Feature): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[FEATURE_REQUIREMENTS[feature]];
}
