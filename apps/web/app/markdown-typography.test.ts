import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesheet = readFileSync(resolve(import.meta.dirname, "globals.css"), "utf8");

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match![1].replace(/\s+/g, " ");
}

describe("rendered Markdown typography", () => {
  it("keeps the compact base rhythm used by the landing-page mock document", () => {
    expect(declarationsFor(".markdown h1")).toContain("margin: 0 0 0.5em;");
    expect(declarationsFor(".markdown p")).toContain("margin: 0 0 1.15em;");
  });

  it("gives later document titles room while keeping the opening title flush", () => {
    expect(declarationsFor(".markdownView h1")).toContain("margin: 3.2rem 0 0.7em;");
    expect(declarationsFor(".markdown > :first-child")).toContain("margin-top: 0;");
  });

  it("keeps paragraphs and lists comfortably separated", () => {
    expect(declarationsFor(".markdownView")).toContain("--lh-body: 1.75;");
    expect(declarationsFor(".markdown")).toContain("line-height: var(--lh-body);");
    expect(declarationsFor(".markdownView p,\n.markdownView ul,\n.markdownView ol")).toContain("margin-bottom: 1.4em;");
    expect(declarationsFor(".markdownView li")).toContain("margin: 0.45em 0;");
  });

  it("separates lower-level headings from body copy", () => {
    expect(declarationsFor(".markdownView")).toMatch(/--text-h3: 1.25rem;.*--text-h4: 1.1rem;/);
    expect(declarationsFor(".markdownView h2")).toContain("margin: 3rem 0 0.85rem;");
    expect(declarationsFor(".markdownView h3")).toMatch(/font-weight: 680;.*margin: 2.4rem 0 0.75rem;/);
    expect(declarationsFor(".markdownView h4")).toContain("margin: 2rem 0 0.6rem;");
  });
});
