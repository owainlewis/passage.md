import { readFileSync } from "node:fs";

const stylesheet = readFileSync("app/writer.css", "utf8");

function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return Object.fromEntries(
    Array.from(match![1].matchAll(/(--[\w-]+):\s*([^;]+);/g), ([, name, value]) => [name, value.trim()])
  );
}

function rgb(color: string) {
  const rgba = color.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
  if (rgba) return rgba.slice(1, 4).map(Number);
  const value = color.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function luminance(color: string) {
  const [red, green, blue] = rgb(color).map((channel) => {
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

// The colour a translucent state layer actually paints over a surface.
function composite(background: string, overlay: string) {
  const alpha = Number.parseFloat(overlay.match(/([\d.]+)\)$/)?.[1] ?? "0");
  const foreground = rgb(overlay);
  return `#${rgb(background)
    .map((channel, index) => Math.round(channel * (1 - alpha) + foreground[index] * alpha).toString(16).padStart(2, "0"))
    .join("")}`;
}

const themes = {
  light: block(":root"),
  dark: { ...block(":root"), ...block(':root[data-theme="dark"]') }
};

describe.each(Object.entries(themes))("writer contrast in the %s theme", (_name, tokens) => {
  const surfaces = [tokens["--w-paper"], tokens["--w-paper-2"], tokens["--w-raised"]];
  const states = surfaces.flatMap((surface) => [
    surface,
    composite(surface, tokens["--w-hover"]),
    composite(surface, tokens["--w-press"])
  ]);

  it.each(["--w-ink", "--w-ink-2", "--w-muted", "--w-faint"])("keeps %s text at WCAG AA in every state", (token) => {
    for (const background of states) {
      expect(contrast(tokens[token], background), `${token} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a visible hierarchy from ink to faint", () => {
    const order = ["--w-ink", "--w-ink-2", "--w-muted", "--w-faint"].map((token) => contrast(tokens[token], tokens["--w-paper"]));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it("draws the focus ring and caret at three-to-one", () => {
    for (const surface of surfaces) {
      expect(contrast(tokens["--w-accent"], surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps decorative rules quiet", () => {
    expect(contrast(tokens["--w-rule"], tokens["--w-paper"])).toBeLessThan(1.6);
  });
});

it("rings keyboard focus in the accent everywhere in the writer", () => {
  expect(stylesheet).toMatch(/\.writer :focus-visible,\s*\.wModalBackdrop :focus-visible\s*\{[^}]*outline: 2px solid var\(--w-accent\);/);
});
