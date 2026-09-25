import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { createVisualEditor, splitFrontmatter, UnsupportedMarkdown, type VisualEditorHandle } from "./visual-editor-runtime";

// jsdom has no layout; ProseMirror scrolls its selection after commands.
// Real selection geometry is covered by the browser checks.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

let handle: VisualEditorHandle | undefined;
afterEach(async () => { await handle?.destroy(); handle = undefined; document.body.innerHTML = ""; });
async function open(source: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const change = vi.fn();
  const error = vi.fn();
  handle = await createVisualEditor(root, source, change, vi.fn(), error);
  return { root, change, error, handle };
}

describe("visual Markdown storage", () => {
  it("keeps frontmatter, including CRLF and blank lines, verbatim", () => {
    const prefix = '---\r\ntags: [writing]\r\ncustom: "keep me"\r\n---\r\n\r\n';
    expect(splitFrontmatter(prefix + "# Draft")).toEqual({ prefix, markdown: "# Draft" });
  });

  it.each([
    "", "# Heading\n\nA **bold** and *italic* paragraph with `code` and ~~strike~~.\n",
    "- [ ] Task\n- [x] Done\n\n1. One\n2. Two\n",
    "| A | B |\n| :-- | --: |\n| One | Two |\n",
    "```mermaid\nflowchart LR\n  A --> B\n```\n",
    "> A quote\n\n[Link](https://example.com)\n\n---\n"
  ])("opens GFM without rewriting or saving: %s", async (source) => {
    const { handle, change } = await open(source);
    expect(handle.source()).toBe(source);
    expect(change).not.toHaveBeenCalled();
    handle.setSource(source);
    expect(change).not.toHaveBeenCalled();
  });

  it.each([
    "```js title=example\nconst x = 1;\n```\n",
    "[Label][ref]\n\n[ref]: https://example.com\n",
  ])("refuses lossy conversion: %s", async (source) => {
    await expect(open(source)).rejects.toBeInstanceOf(UnsupportedMarkdown);
  });

  it.each(["---\n---\n\n", "---\r\n---\r\n\r\n"])("preserves empty frontmatter through visual edits: %s", async (prefix) => {
    expect(splitFrontmatter(prefix + "# Draft").prefix).toBe(prefix);
    const { handle, change } = await open(prefix + "# Draft\n");
    handle.heading(2);
    expect(change).toHaveBeenLastCalledWith(prefix + "## Draft\n");
  });

  it("saves a visual edit synchronously as Markdown with metadata and diagrams intact", async () => {
    const prefix = "---\ntags: [writing]\ncustom: keep\n---\n\n";
    const { root, change, error } = await open(prefix + "# Draft\n\n```mermaid\nflowchart LR\n  A --> B\n```\n");
    const heading = root.querySelector("h1")!;
    heading.textContent = "Updated draft";
    fireEvent.input(heading);
    await waitFor(() => expect(change).toHaveBeenCalled());
    const saved = change.mock.lastCall![0];
    expect(saved).toMatch(/^---\ntags: \[writing\]\ncustom: keep\n---\n\n# Updated draft/);
    expect(saved).toContain("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(error).not.toHaveBeenCalled();
  });

  it("applies H1/H2/H3 and paragraph styles as Markdown and supports undo", async () => {
    const { root, handle, change } = await open("A thought\n");
    for (const level of [1, 2, 3]) {
      handle.heading(level);
      expect(root.querySelector(`h${level}`)).toHaveTextContent("A thought");
      expect(change.mock.lastCall![0]).toBe(`${"#".repeat(level)} A thought\n`);
    }
    handle.heading(0);
    expect(change.mock.lastCall![0]).toBe("A thought\n");
    fireEvent.keyDown(root.querySelector('[role="textbox"]')!, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(root.querySelector("h3")).toHaveTextContent("A thought");
  });

  it("toggles a task with a native checkbox without dropping sibling content", async () => {
    const { root, change } = await open("- [ ] Draft\n- [x] Reviewed\n");
    fireEvent.click(root.querySelector('input[type="checkbox"]')!);
    expect(change.mock.lastCall![0]).toContain("[x] Draft");
    expect(change.mock.lastCall![0]).toContain("[x] Reviewed");
  });

  it("never exposes an executable link URL", async () => {
    const { root, change } = await open("[Link](javascript:alert%281%29)\n");
    expect(root.querySelector("a")?.getAttribute("href")).not.toContain("javascript:");
    expect(change).not.toHaveBeenCalled();
  });

  it("replaces external content without sending it back as a local save", async () => {
    const { root, handle, change } = await open("# First\n");
    handle.setSource("# Remote replacement\n");
    expect(root.querySelector("h1")).toHaveTextContent("Remote replacement");
    expect(change).not.toHaveBeenCalled();
  });
});
