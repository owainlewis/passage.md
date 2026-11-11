import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  createVisualEditor, splitFrontmatter, UnsupportedMarkdown,
  type BlockMenuOptions, type EditorObservers, type VisualEditorHandle
} from "./visual-editor-runtime";

// jsdom has no layout; ProseMirror scrolls its selection after commands.
// Real selection geometry is covered by the browser checks.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

let handle: VisualEditorHandle | undefined;
afterEach(async () => { await handle?.destroy(); handle = undefined; document.body.innerHTML = ""; });
async function open(source: string, blocks?: BlockMenuOptions, observers?: EditorObservers) {
  const root = document.createElement("div");
  document.body.append(root);
  const change = vi.fn();
  const error = vi.fn();
  handle = await createVisualEditor(root, source, change, error, blocks, observers);
  return { root, change, error, handle };
}

function placeCaret(root: HTMLElement, node: Node, offset: number) {
  root.querySelector<HTMLElement>('[role="textbox"]')!.focus();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event("selectionchange"));
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

describe("slash block insertion", () => {
  it.each([
    ["paragraph", "p"], ["heading-1", "h1"], ["heading-2", "h2"], ["heading-3", "h3"],
    ["bullet-list", "ul"], ["numbered-list", "ol"], ["task-list", 'input[type="checkbox"]'],
    ["quote", "blockquote"], ["code", "pre"], ["divider", "hr"]
  ] as const)("inserts %s while preserving metadata, trailing text, and neighbouring blocks", async (command, selector) => {
    const menu = vi.fn();
    const prefix = "---\ntags: [writing]\ncustom: keep\n---\n\n";
    const { root, handle, change, error } = await open(prefix + "# Before\n\n/Keep this text\n\n## After\n", { onChange: menu, onKeyDown: () => false });
    const input = root.querySelector<HTMLElement>('[role="textbox"]')!;
    input.focus();
    const range = document.createRange();
    range.setStart(root.querySelector("p")!.firstChild!, 1);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    await waitFor(() => expect(menu).toHaveBeenLastCalledWith(expect.objectContaining({ query: "" })));
    expect(handle.insertBlock(command)).toBe(true);
    expect(root.querySelector(selector)).not.toBeNull();
    expect(handle.source()).toMatch(/^---\ntags: \[writing\]\ncustom: keep\n---\n\n/);
    expect(handle.source()).toContain("# Before");
    expect(handle.source()).toContain("Keep this text");
    expect(handle.source()).toContain("## After");
    expect(handle.source()).not.toContain("/Keep");
    expect(change).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(handle.source()).toContain("/Keep this text");
  });
});

describe("focus", () => {
  const source = "# Draft\n\nFirst sentence here. Second sentence here.\n";

  it("lights only the sentence the caret is in", async () => {
    const { root, handle } = await open(source);
    handle.setModes({ focus: true });
    const content = root.querySelector('[role="textbox"]')!;
    expect(content).toHaveClass("wFocusOn");

    placeCaret(root, root.querySelector("p")!.firstChild!, 3);
    await waitFor(() => expect(root.querySelector(".wFocusText")).toHaveTextContent("First sentence here."));
    expect(root.querySelector(".wFocusBlock")).toBe(root.querySelector("p"));

    handle.setModes({ focus: false });
    expect(content).not.toHaveClass("wFocusOn");
    expect(root.querySelector(".wFocusText")).toBeNull();
  });

  it("never changes or saves the Markdown", async () => {
    const { handle, change, error } = await open(source);
    handle.setModes({ focus: true });
    handle.setModes({ focus: false });
    expect(handle.source()).toBe(source);
    expect(change).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps focus when the document is replaced from outside", async () => {
    const { root, handle } = await open(source);
    handle.setModes({ focus: true });
    handle.setSource("# Remote\n\nThis was changed.\n");
    expect(root.querySelector('[role="textbox"]')).toHaveClass("wFocusOn");
  });

  it("starts in the mode it is given", async () => {
    const { root } = await open(source, undefined, { modes: { focus: true } });
    expect(root.querySelector('[role="textbox"]')).toHaveClass("wFocusOn");
  });
});

describe("document reports", () => {
  it("reports the outline with the words in each section", async () => {
    const onOutline = vi.fn();
    await open("# Title\n\nOne two.\n\n## Part\n\nThree four five.\n\n### Detail\n\nSix.\n\n## Next\n\nSeven eight.\n", undefined, { onOutline });
    expect(onOutline).toHaveBeenLastCalledWith([
      { level: 1, text: "Title", words: 11 },
      { level: 2, text: "Part", words: 5 },
      { level: 3, text: "Detail", words: 1 },
      { level: 2, text: "Next", words: 2 }
    ]);
  });

  it("reports the outline again only when it changes", async () => {
    const onOutline = vi.fn();
    const { handle } = await open("# Title\n\nBody.\n", undefined, { onOutline });
    expect(onOutline).toHaveBeenCalledTimes(1);
    handle.setModes({ focus: true });
    expect(onOutline).toHaveBeenCalledTimes(1);
    handle.setSource("# Title\n\nBody.\n\n## More\n");
    expect(onOutline).toHaveBeenLastCalledWith([
      { level: 1, text: "Title", words: 2 },
      { level: 2, text: "More", words: 0 }
    ]);
  });

  it("moves the caret to a heading chosen from the outline", async () => {
    const { root, handle } = await open("# Title\n\nBody.\n\n## Part\n\nMore.\n");
    handle.setModes({ focus: true });
    handle.revealHeading(1);
    expect(root.querySelector(".wFocusBlock")).toBe(root.querySelector("h2"));
  });

  it("reports the words in the selection", async () => {
    const onSelection = vi.fn();
    const { root } = await open("One two three four.\n", undefined, { onSelection });
    const text = root.querySelector("p")!.firstChild!;
    root.querySelector<HTMLElement>('[role="textbox"]')!.focus();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    await waitFor(() => expect(onSelection).toHaveBeenLastCalledWith(2));
  });
});
