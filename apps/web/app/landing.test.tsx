import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Landing from "./page";
import { ThemeProvider } from "./theme";

const landingStyles = readFileSync("app/landing.module.css", "utf8");
const paperStyles = readFileSync("app/paper.module.css", "utf8");
const writerStyles = readFileSync("app/writer.css", "utf8");

function tokens(stylesheet: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return Object.fromEntries(
    Array.from(match![1].matchAll(/--[pw]-([\w-]+):\s*([^;]+);/g), ([, name, value]) => [name, value.trim()])
  );
}

function renderLanding() {
  return render(
    <ThemeProvider>
      <Landing />
    </ThemeProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ authenticated: false, publicSignupEnabled: true }), { status: 200 }))
  );
});

describe("landing materials", () => {
  it.each([
    ["light", ".paper", ":root"],
    ["dark", ':global(:root[data-theme="dark"]) .paper', ':root[data-theme="dark"]']
  ])("uses the writer's colours in the %s theme", (_name, landingSelector, writerSelector) => {
    const landing = tokens(paperStyles, landingSelector);
    const writer = tokens(writerStyles, writerSelector);
    const shared = Object.keys(landing).filter((name) => name in writer);

    expect(shared).toEqual(
      expect.arrayContaining(["paper", "paper-2", "raised", "ink", "ink-2", "muted", "faint", "rule", "accent"])
    );
    for (const name of shared) {
      expect(landing[name], `--p-${name}`).toBe(writer[name]);
    }
  });

  it("uses the writer's bar, measure and faces", () => {
    const landing = tokens(paperStyles, ".paper");
    const writer = tokens(writerStyles, ":root");

    for (const name of ["bar", "control", "measure", "radius", "radius-lg"]) {
      expect(landing[name], `--p-${name}`).toBe(writer[name]);
    }
    for (const name of ["prose", "ui", "mono"]) {
      expect(landing[name], `--p-${name}`).toBe(writer[name]);
    }
  });

  it("stills the caret for readers who ask for less motion", () => {
    const reduced = landingStyles.slice(landingStyles.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reduced).toMatch(/\.caret\s*\{\s*animation: none;/);
  });

  it("takes every colour from the shared paper tokens", () => {
    const rules = landingStyles.replace(/--l-(row-)?shadow:[^;]+;/g, "");

    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rules).not.toMatch(/rgba?\(/);
  });
});

describe("landing page", () => {
  it("leads with one action and a way to see the price", async () => {
    renderLanding();

    const hero = screen.getByRole("heading", { level: 1, name: "A quiet place to write." }).closest("section")!;
    expect(await within(hero).findByRole("link", { name: "Create free account" })).toHaveAttribute("href", "/signup");
    expect(within(hero).getByRole("link", { name: "See pricing" })).toHaveAttribute("href", "#pricing");
    expect(document.getElementById("pricing")).toContainElement(screen.getByRole("heading", { name: "Simple pricing" }));
  });

  it("repeats the action at the foot of the page", async () => {
    renderLanding();

    const closing = screen.getByRole("heading", { name: "Start with a blank page." }).closest("section")!;
    expect(await within(closing).findByRole("link", { name: "Create free account" })).toHaveAttribute("href", "/signup");
  });

  it("does not offer pricing to a reader who already has Pro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              authenticated: true,
              user: { id: "user-1", email: "writer@example.com" },
              account: {
                plan: "pro",
                source: "stripe",
                limits: { maxSavedDocs: 2000 },
                usage: { savedDocs: 1 },
                subscription: { status: "active", cancelAtPeriodEnd: false }
              }
            }),
            { status: 200 }
          )
      )
    );
    renderLanding();

    expect(await screen.findByText("Passage Pro is active.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See pricing" })).not.toBeInTheDocument();
  });

  it("switches the theme from the sun and moon button in the bar", async () => {
    renderLanding();

    const toggle = screen.getByRole("button", { name: "Dark mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(localStorage.getItem("passage.theme.v1")).toBe("dark");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
    expect(localStorage.getItem("passage.theme.v1")).toBe("light");
  });

  it("keeps the picture of the writer out of the accessibility tree", () => {
    renderLanding();

    expect(screen.getByText("Research notes").closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Morning pages" })).not.toBeInTheDocument();
    expect(screen.getByText("Morning pages", { selector: "p" }).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("shows the command that connects an agent, and where to set it up", () => {
    renderLanding();

    expect(screen.getByText(/claude mcp add --transport http passage/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect an agent" })).toHaveAttribute("href", "/agents");
  });
});
