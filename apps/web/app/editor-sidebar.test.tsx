import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { EditorSidebar } from "./editor-sidebar";
import type { Doc } from "./editor-model";
import { WORKSPACE_COLLECTIONS } from "./editor-workspace-model";

const stylesheet = readFileSync("app/globals.css", "utf8");

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match![1].replace(/\s+/g, " ");
}

function sidebar(overrides: Partial<Parameters<typeof EditorSidebar>[0]> = {}, docs: Doc[] = []) {
  return (
    <EditorSidebar
      accountEmail="writer@example.com"
      assignments={{}}
      collections={WORKSPACE_COLLECTIONS}
      deletedCollections={[]}
      docs={docs}
      onOpenCollection={vi.fn()}
      onOpenSearch={vi.fn()}
      onOpenTemplates={vi.fn()}
      onOpenView={vi.fn()}
      onToggleDarkMode={vi.fn()}
      sidebarOpen
      templateCount={3}
      templatesActive={false}
      theme="light"
      view={{ type: "home" }}
      {...overrides}
    />
  );
}

function destination(name: string | RegExp) {
  const nav = screen.getByLabelText("Workspace destinations");
  return within(nav).getByRole("button", { name });
}

describe("desktop destination icons", () => {
  it("gives every desktop destination an icon beside its label", () => {
    render(sidebar());

    for (const name of [/^Home$/, /^Starred/, /^Recent$/, /^Templates$/]) {
      const button = destination(name);
      const icon = button.querySelector(":scope > svg");
      expect(icon, `${name} has no icon`).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(button.firstElementChild).toBe(icon);
    }
  });

  it("uses the same icon as the mobile nav for each shared destination", () => {
    render(sidebar());
    const mobile = screen.getByLabelText("Mobile workspace navigation");

    for (const name of ["Home", "Starred", "Recent"]) {
      const desktopIcon = destination(new RegExp(`^${name}`)).querySelector(":scope > svg")!;
      const mobileIcon = within(mobile).getByRole("button", { name }).querySelector("svg")!;
      expect(desktopIcon.innerHTML).toBe(mobileIcon.innerHTML);
    }
  });

  it("announces each destination once, from the label rather than the icon", () => {
    render(sidebar(undefined, [{ id: "a", body: "# A", bodyLoaded: true, pinned: true } as Doc]));

    expect(destination(/^Starred/)).toHaveTextContent("Starred1");
    expect(destination(/^Home$/)).toHaveAccessibleName("Home");
  });

  it("keeps counts and the active state working alongside the icon", () => {
    render(sidebar({ view: { type: "starred" } }));

    expect(destination(/^Templates$/)).toHaveTextContent("3");
    expect(destination(/^Starred/)).toHaveAttribute("data-active", "true");
    expect(destination(/^Home$/)).toHaveAttribute("data-active", "false");
  });

  it("sizes destination icons without letting them shrink or drift from the label colour", () => {
    const rule = declarationsFor(".workspaceDestination > svg");
    expect(rule).toContain("flex: 0 0 auto;");
    expect(rule).toContain("color: inherit;");
    expect(stylesheet).toMatch(/\.workspaceDestination span,\s*\n\.workspaceSidebarCollection > span:first-child\s*\{[^}]*flex: 1 1 auto;/);
  });
});

describe("sidebar account footer", () => {
  it("links to the account page and shows who is signed in", () => {
    render(sidebar());
    const link = screen.getByRole("link", { name: /Settings/ });

    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveClass("workspaceSidebarAccount");
    expect(link).toHaveTextContent("writer@example.com");
  });

  it("still renders a usable Settings link when the email is not known yet", () => {
    render(sidebar({ accountEmail: undefined }));
    const link = screen.getByRole("link", { name: "Settings" });

    expect(link).toHaveAttribute("href", "/account");
    expect(link.querySelector("small")).toBeNull();
  });

  it("keeps the theme toggle beside the Settings link", () => {
    render(sidebar());
    const foot = document.querySelector(".workspaceSidebarFoot")!;

    expect(within(foot as HTMLElement).getByRole("link", { name: /Settings/ })).toBeInTheDocument();
    expect(within(foot as HTMLElement).getByRole("switch", { name: "Dark mode" })).toBeInTheDocument();
  });

  it("truncates a long email instead of widening the sidebar", () => {
    render(sidebar({ accountEmail: `${"long".repeat(30)}@example.com` }));

    const rule = declarationsFor(".workspaceSidebarAccountText small");
    expect(rule).toContain("overflow: hidden;");
    expect(rule).toContain("text-overflow: ellipsis;");
    expect(rule).toContain("white-space: nowrap;");
    expect(declarationsFor(".workspaceSidebarAccountText")).toContain("min-width: 0;");
  });

  it("gives the Settings link a visible hover and focus state", () => {
    expect(declarationsFor(".workspaceSidebarAccount:hover,\n.workspaceSidebarAccount:focus-visible"))
      .toContain("background: var(--hover);");
  });
});
