import {
  Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx,
  parserCtx, remarkCtx, rootCtx, serializerCtx
} from "@milkdown/kit/core";
import { $view } from "@milkdown/kit/utils";
import { listItemSchema, commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { setBlockType } from "@milkdown/kit/prose/commands";
import { closeHistory } from "@milkdown/kit/prose/history";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import type { BlockCommand } from "./editor-block-commands";

export type BlockMenuState = { query: string; left: number; top: number };
export type BlockMenuOptions = {
  onChange: (state: BlockMenuState | null) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
};


// Keep metadata byte-for-byte outside the visual editor's parser/serializer.
export function splitFrontmatter(source: string) {
  const prefix = source.match(/^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)(?:\r?\n)*/)?.[0] ?? "";
  return { prefix, markdown: source.slice(prefix.length) };
}

// Compare meaning, allowing only source layout differences. Unknown nodes,
// HTML, reference definitions, code metadata, etc. must survive or use Source.
function semanticTree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticTree);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["position", "spread"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, semanticTree(child)]));
}

export class UnsupportedMarkdown extends Error {}

export async function createVisualEditor(
  root: HTMLElement,
  source: string,
  onChange: (markdown: string) => void,
  onError: () => void,
  blockMenu?: BlockMenuOptions
) {
  let currentSource = source;
  let { prefix, markdown } = splitFrontmatter(source);
  let ready = false;
  let destroyed = false;
  let dispatchDepth = 0;
  let dismissedBlock: number | null = null;
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(editorViewOptionsCtx, {
        attributes: {
          class: "markdown visualEditorContent",
          "aria-label": "Visual editor",
          "aria-multiline": "true",
          spellcheck: "true"
        },
        // Keep a small breathing space around the caret while scrolling.
        scrollMargin: { top: 24, right: 5, bottom: 24, left: 5 },
        dispatchTransaction(this: EditorView, transaction) {
          if (!ready || destroyed) return;
          dispatchDepth += 1;
          try {
            const previousDoc = this.state.doc;
            const next = this.state.applyTransaction(transaction).state;
            // Verify serialization before rendering. Milkdown may dispatch a
            // nested heading-ID transaction during updateState, so publish
            // only the final view state from the outermost dispatch.
            if (!next.doc.eq(previousDoc)) ctx.get(serializerCtx)(next.doc);
            this.updateState(next);
            if (dispatchDepth === 1) {
              const nextSource = this.state.doc.eq(previousDoc) ? currentSource : prefix + ctx.get(serializerCtx)(this.state.doc);
              if (nextSource !== currentSource) {
                currentSource = nextSource;
                onChange(nextSource);
              }
              reportBlocks(this);
            }
          } catch {
            onError();
          } finally {
            dispatchDepth -= 1;
          }
        },
        handleKeyDown(view, event) {
          const range = blockRange(view);
          if (view.composing || event.isComposing || !range || dismissedBlock === range.block) return false;
          return blockMenu?.onKeyDown(event) ?? false;
        },
        handleDOMEvents: {
          focus(view) { reportBlocks(view); return false; },
          blur() { blockMenu?.onChange(null); return false; }
        },
        handleClick(_view, _pos, event) {
          // Links are edited here; Preview is the surface for following them.
          if ((event.target as Element).closest("a")) { event.preventDefault(); return true; }
          return false;
        }
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(cursor)
    .use($view(listItemSchema.node, () => (node, view, getPos) => {
      const dom = document.createElement("li");
      const contentDOM = document.createElement("div");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.contentEditable = "false";
      checkbox.setAttribute("aria-label", "Mark task complete");
      dom.append(checkbox, contentDOM);
      function update(item: typeof node) {
        if (item.type !== node.type) return false;
        dom.dataset.task = String(item.attrs.checked != null);
        checkbox.hidden = item.attrs.checked == null;
        checkbox.checked = item.attrs.checked === true;
        checkbox.setAttribute("aria-label", `Mark task complete: ${item.textContent}`);
        return true;
      }
      update(node);
      checkbox.addEventListener("change", () => {
        const pos = getPos();
        if (pos == null) return;
        const current = view.state.doc.nodeAt(pos);
        if (current) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: checkbox.checked }));
      });
      return {
        dom, contentDOM, update,
        stopEvent: (event) => event.target === checkbox,
        ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target)
      };
    }));

  function blockRange(view: EditorView) {
    const { empty, from, $from } = view.state.selection;
    // Blocks are inserted from a top-level paragraph, never inside code or links.
    if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph") return null;
    const text = $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc");
    if (!/^\/[^\/\n]{0,40}$/.test(text)) return null;
    return { from: $from.start(), to: from, block: $from.before(), query: text.slice(1) };
  }

  function reportBlocks(view: EditorView) {
    if (!blockMenu || !ready || destroyed) return;
    const range = blockRange(view);
    if (!range) dismissedBlock = null;
    if (!range || !view.hasFocus() || dismissedBlock === range.block) {
      blockMenu.onChange(null);
      return;
    }
    // A temporary layout failure should close the menu, not stop editing.
    try {
      const caret = view.coordsAtPos(view.state.selection.from);
      blockMenu.onChange({ query: range.query, left: caret.left, top: caret.bottom });
    } catch {
      blockMenu.onChange(null);
    }
  }

  function assertCompatible(input: string, serialized: string) {
    const remark = editor.ctx.get(remarkCtx);
    if (JSON.stringify(semanticTree(remark.parse(input))) !== JSON.stringify(semanticTree(remark.parse(serialized)))) {
      throw new UnsupportedMarkdown("This document needs source editing to preserve its Markdown.");
    }
  }

  try {
    await editor.create();
    const view = editor.ctx.get(editorViewCtx);
    assertCompatible(markdown, editor.ctx.get(serializerCtx)(view.state.doc));
    ready = true;
    const reposition = () => reportBlocks(view);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return {
      source: () => currentSource,
      focus() { view.focus(); reportBlocks(view); },
      dismissBlocks() {
        dismissedBlock = blockRange(view)?.block ?? null;
        blockMenu?.onChange(null);
      },
      setBlockSelection(listId: string | null, optionId: string | null) {
        for (const [name, value] of [["aria-controls", listId], ["aria-activedescendant", optionId]] as const) {
          if (value) view.dom.setAttribute(name, value);
          else view.dom.removeAttribute(name);
        }
      },
      insertBlock(command: BlockCommand) {
        const range = blockRange(view);
        if (!range) return false;
        const { schema } = view.state;
        const tr = closeHistory(view.state.tr).delete(range.from, range.to);
        const paragraph = tr.doc.nodeAt(range.block)!;
        let replacement = paragraph;
        if (command.startsWith("heading-")) {
          replacement = schema.nodes.heading.create({ level: Number(command.slice(-1)) }, paragraph.content);
        } else if (["bullet-list", "numbered-list", "task-list"].includes(command)) {
          const ordered = command === "numbered-list";
          const item = schema.nodes.list_item.create({
            listType: ordered ? "ordered" : "bullet", label: ordered ? "1." : "•",
            spread: false, checked: command === "task-list" ? false : null
          }, paragraph);
          replacement = schema.nodes[ordered ? "ordered_list" : "bullet_list"].create(null, item);
        } else if (command === "quote") {
          replacement = schema.nodes.blockquote.create(null, paragraph);
        } else if (command === "code") {
          replacement = schema.nodes.code_block.create(null, paragraph.textContent ? schema.text(paragraph.textContent) : null);
        }
        const nodes = command === "divider" ? [schema.nodes.hr.create(), paragraph] : [replacement];
        tr.replaceWith(range.block, range.block + paragraph.nodeSize, nodes);
        const caret = range.block + (command === "divider" ? nodes[0].nodeSize : 0) + 1;
        tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
        dismissedBlock = null;
        view.dispatch(tr.scrollIntoView());
        view.focus();
        return true;
      },
      heading(level: number) {
        view.dispatch(closeHistory(view.state.tr));
        const type = level ? view.state.schema.nodes.heading : view.state.schema.nodes.paragraph;
        setBlockType(type, level ? { level } : undefined)(view.state, view.dispatch);
        view.focus();
      },
      setSource(nextSource: string) {
        if (nextSource === currentSource) return;
        const next = splitFrontmatter(nextSource);
        const doc = editor.ctx.get(parserCtx)(next.markdown);
        assertCompatible(next.markdown, editor.ctx.get(serializerCtx)(doc));
        // External replacements (including conflict recovery) start a fresh
        // history. Undo must never restore a discarded remote version.
        ready = false;
        dismissedBlock = null;
        view.updateState(EditorState.create({ schema: view.state.schema, doc, plugins: view.state.plugins }));
        ready = true;
        prefix = next.prefix;
        markdown = next.markdown;
        currentSource = nextSource;
        reportBlocks(view);
      },
      async destroy() {
        destroyed = true;
        ready = false;
        window.removeEventListener("scroll", reposition, true);
        window.removeEventListener("resize", reposition);
        await editor.destroy();
      }
    };
  } catch (error) {
    await editor.destroy();
    throw error;
  }
}

export type VisualEditorHandle = Awaited<ReturnType<typeof createVisualEditor>>;
