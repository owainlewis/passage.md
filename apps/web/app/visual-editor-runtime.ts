import {
  Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx,
  parserCtx, remarkCtx, rootCtx, serializerCtx
} from "@milkdown/kit/core";
import { $view } from "@milkdown/kit/utils";
import { listItemSchema, commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { setBlockType, toggleMark } from "@milkdown/kit/prose/commands";
import { closeHistory } from "@milkdown/kit/prose/history";
import { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export type Formatting = { bold: boolean; italic: boolean; strike: boolean; code: boolean; heading: number };
export type Format = "bold" | "italic" | "strike" | "code";

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
  onFormatting: (formatting: Formatting) => void,
  onError: () => void
) {
  let currentSource = source;
  let { prefix, markdown } = splitFrontmatter(source);
  let ready = false;
  let destroyed = false;
  let dispatchDepth = 0;
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
              reportFormatting(this);
            }
          } catch {
            onError();
          } finally {
            dispatchDepth -= 1;
          }
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

  function reportFormatting(view: EditorView) {
    const { from, to, empty, $from } = view.state.selection;
    const marks = view.state.storedMarks ?? $from.marks();
    const has = (name: string) => {
      const type = view.state.schema.marks[name];
      return Boolean(type && (empty ? marks.some((mark) => mark.type === type) : view.state.doc.rangeHasMark(from, to, type)));
    };
    onFormatting({ bold: has("strong"), italic: has("emphasis"), strike: has("strike_through"), code: has("inlineCode"), heading: $from.parent.type.name === "heading" ? $from.parent.attrs.level : 0 });
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
    reportFormatting(view);
    return {
      source: () => currentSource,
      focus: () => view.focus(),
      format(format: Format) {
        view.dispatch(closeHistory(view.state.tr));
        const name = { bold: "strong", italic: "emphasis", strike: "strike_through", code: "inlineCode" }[format];
        toggleMark(view.state.schema.marks[name])(view.state, view.dispatch);
        view.focus();
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
        view.updateState(EditorState.create({ schema: view.state.schema, doc, plugins: view.state.plugins }));
        ready = true;
        prefix = next.prefix;
        markdown = next.markdown;
        currentSource = nextSource;
        reportFormatting(view);
      },
      async destroy() {
        destroyed = true;
        ready = false;
        await editor.destroy();
      }
    };
  } catch (error) {
    await editor.destroy();
    throw error;
  }
}

export type VisualEditorHandle = Awaited<ReturnType<typeof createVisualEditor>>;
