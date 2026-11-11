import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import AgentsPage from "./agents/page";
import Cancellation from "./cancellation/page";
import Privacy from "./privacy/page";
import Refunds from "./refunds/page";
import Terms from "./terms/page";

const readingStyles = readFileSync("app/reading.module.css", "utf8");
const globalStyles = readFileSync("app/globals.css", "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = readingStyles.match(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe("reading pages", () => {
  it.each([
    ["the agents guide", <AgentsPage key="agents" />, "Connect your agents to Passage.", "Write", "/write"],
    ["the terms", <Terms key="terms" />, "Terms of Service", "Start writing", "/write"],
    ["the privacy policy", <Privacy key="privacy" />, "Privacy Policy", "Start writing", "/write"],
    ["the refund policy", <Refunds key="refunds" />, "Refund Policy", "Start writing", "/write"],
    ["the cancellation policy", <Cancellation key="cancellation" />, "Cancellation Policy", "Start writing", "/write"]
  ])("frames %s with the wordmark home and the writer's bar", (_name, page, title, label, href) => {
    render(page);

    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("link", { name: "passage.md home" })).toHaveAttribute("href", "/");
    expect(within(bar).getByRole("link", { name: label })).toHaveAttribute("href", href);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("drops the kickers and keeps the setup steps in order", () => {
    render(<AgentsPage />);

    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
    expect(screen.queryByText("Tools")).not.toBeInTheDocument();
    expect(screen.queryByText("Safety")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Create an API token",
      "Add Passage to your agent",
      "What your agent can do",
      "You stay in charge"
    ]);
    expect(within(screen.getByRole("region", { name: "Create an API token" })).getByText("Step 1")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Add Passage to your agent" })).getByText("Step 2")).toBeInTheDocument();
  });

  it("drops the kicker from the policies", () => {
    render(<Terms />);

    expect(screen.queryByText("Passage policies")).not.toBeInTheDocument();
  });
});

describe("reading materials", () => {
  it("draws every colour from the shared paper tokens", () => {
    expect(readingStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(readingStyles).not.toMatch(/rgba?\(/);
  });

  it("sets headings in the writing face at the writer's weights", () => {
    expect(rule(".title")).toMatch(/font-family: var\(--p-prose\);/);
    expect(rule(".title")).toMatch(/font-weight: 400;/);
    expect(rule(".prose")).toMatch(/font-family: var\(--p-prose\);/);
    expect(rule(".prose h2")).toMatch(/font-weight: 520;/);
    expect(rule(".prose h3")).toMatch(/font-weight: 600;/);
  });

  it("keeps the words on the writer's measure and code on the code surface", () => {
    expect(rule(".column,\n.footer")).toMatch(/var\(--p-measure\)/);
    expect(rule(".prose pre")).toMatch(/background: var\(--p-code\);/);
    expect(rule(".prose pre")).toMatch(/overflow-x: auto;/);
  });

  it("leaves no styles behind for the old look", () => {
    expect(globalStyles).not.toMatch(/\.agents[A-Z]|\.policy[A-Z]|\.btnGhost/);
  });
});
