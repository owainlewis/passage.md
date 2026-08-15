import { readFileSync } from "node:fs";

const stylesheet = readFileSync("app/globals.css", "utf8");

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match![1].replace(/\\s+/g, " ");
}

function customProperties(declarations: string) {
  return Object.fromEntries(
    Array.from(declarations.matchAll(/(--[\w-]+):\s*([^;]+);/g), ([, name, value]) => [name, value.trim()])
  );
}

function rgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function luminance(hex: string) {
  const [red, green, blue] = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeBlack(background: string, overlay: string) {
  const alpha = Number.parseFloat(overlay.match(/rgba\(0, 0, 0, ([\d.]+)\)/)?.[1] ?? "0");
  return `#${rgb(background)
    .map((channel) => Math.round(channel * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("light workspace contrast", () => {
  const light = customProperties(declarationsFor(':root:not([data-theme="dark"]) .workspace'));
  const backgrounds = ["#fbfbf9", "#f5f4f1"];
  const stateBackgrounds = backgrounds.flatMap((background) => [
    background,
    compositeBlack(background, light["--hover-soft"]),
    compositeBlack(background, light["--hover"]),
    compositeBlack(background, light["--hover-strong"])
  ]);

  it.each(["--muted", "--faint"])("keeps %s normal text at WCAG AA contrast in every interaction state", (token) => {
    for (const background of stateBackgrounds) {
      expect(contrast(light[token], background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("preserves a secondary hierarchy without making faint copy non-compliant", () => {
    expect(luminance(light["--faint"])).toBeGreaterThan(luminance(light["--muted"]));
    expect(contrast(light["--faint"], "#f5f4f1")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps meaningful control boundaries at non-text contrast", () => {
    for (const background of backgrounds) {
      expect(contrast(light["--control-boundary"], background)).toBeGreaterThanOrEqual(3);
    }

    for (const selector of [
      ".docCount",
      ".documentFilter",
      ".filterInput",
      ".templateSidebarCount",
      ".tagFilterInput",
      ".docListMore",
      ".workspaceDocumentIcon",
      ".workspaceCollectionSelect,\n.topBarCollectionSelect",
      ".workspaceSearchEmpty button,\n.workspaceSearchResults > .workspaceSearchMore",
      ".workspaceLoadMore button",
      ".statusPill",
      ".dockButton"
    ]) {
      expect(declarationsFor(selector)).toContain("var(--control-boundary)");
    }

    for (const selector of [".workspaceSidebarSearch > button", ".workspaceSearchButton"]) {
      expect(declarationsFor(selector)).toContain("var(--hairline-strong)");
    }
  });

  it("uses the AA text token for the reported labels, counts, metadata, and icons", () => {
    for (const selector of [
      ".workspaceDestination small,\n.workspaceSidebarCollection small",
      ".workspaceSidebarLabel",
      ".workspaceSectionHeading button,\n.workspaceSectionHeading span",
      ".workspaceCollectionTitle small",
      ".workspaceDocumentText small",
      ".workspaceDocumentSummary",
      ".workspaceStarButton",
      ':root:not([data-theme="dark"]) .workspace .workspaceSearchInput input::placeholder',
      ".workspaceSearchResults > p",
      ".workspaceSearchResults small",
      ".workspaceSearchFooter"
    ]) {
      expect(declarationsFor(selector)).toContain("color: var(--faint)");
    }
  });

  it("provides a three-to-one focus indicator without changing dark theme tokens", () => {
    expect(contrast("#48685f", "#fbfbf9")).toBeGreaterThanOrEqual(3);
    expect(stylesheet).toMatch(
      /:root:not\(\[data-theme="dark"\]\) \.workspace\s+:is\(button, a, select, input, textarea\)[^{]*:focus-visible\s*\{[^}]*outline: 2px solid var\(--accent\);/
    );

    const dark = customProperties(declarationsFor(':root[data-theme="dark"]'));
    expect(dark).toMatchObject({
      "--muted": "#969da8",
      "--faint": "#68717d",
      "--hairline": "#282d35",
      "--hairline-strong": "#363d47"
    });
    expect(customProperties(declarationsFor(".workspace"))["--control-boundary"]).toBe("var(--hairline)");
    expect(dark["--control-boundary"]).toBeUndefined();
    expect(stylesheet).not.toMatch(/(?:^|\})\s*\.workspaceSearchInput input::placeholder\s*\{/);
  });

  it("strengthens row collection boundaries only in the light workspace", () => {
    expect(declarationsFor(".workspaceCollectionSelect")).toContain("border-color: transparent");
    expect(
      declarationsFor(':root:not([data-theme="dark"]) .workspace .workspaceCollectionSelect')
    ).toContain("border-color: var(--control-boundary)");
  });

  it("keeps hover, active, selected, disabled, and error states distinct", () => {
    expect(light).toMatchObject({
      "--hover": "rgba(0, 0, 0, 0.075)",
      "--hover-soft": "rgba(0, 0, 0, 0.055)",
      "--hover-strong": "rgba(0, 0, 0, 0.11)"
    });
    expect(declarationsFor('.workspaceDestination[data-active="true"],\n.workspaceSidebarCollection[data-active="true"]')).toContain(
      "font-weight: 650"
    );
    expect(declarationsFor(".workspaceCollectionDialog footer button:disabled")).toContain("opacity: 0.45");
    expect(declarationsFor(".templateError")).toContain("color: #9e3f36");
  });
});
