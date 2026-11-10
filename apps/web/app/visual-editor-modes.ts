import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

import { sentenceAt } from "./prose-analysis";

export type EditorModes = { focus: boolean };
export type OutlineItem = { level: number; text: string; words: number };

type ModesState = { modes: EditorModes; decorations: DecorationSet };

export const modesKey = new PluginKey<ModesState>("passageModes");

// Inline code and embedded nodes hold their place as a character that ends
// no sentence, so an offset into the text is also an offset into the block.
const OPAQUE = "￼";

function blockText(block: Node) {
  let text = "";
  block.forEach((child) => {
    const prose = child.isText && !child.marks.some((mark) => mark.type.spec.code);
    text += prose ? child.text : OPAQUE.repeat(child.nodeSize);
  });
  return text;
}

// Lights the block the caret is in and, inside it, the sentence being
// written. Everything else is dimmed by the stylesheet.
function focusDecorations(state: EditorState) {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    return [Decoration.node(selection.from, selection.to, { class: "wFocusBlock" })];
  }
  const { $head } = selection;
  if ($head.depth === 0) return [];
  const decorations = [Decoration.node($head.before(1), $head.after(1), { class: "wFocusBlock" })];
  const block = $head.parent;
  if (!block.isTextblock || !block.content.size) return decorations;
  const start = $head.start();
  const sentence = block.type.spec.code
    ? { from: 0, to: block.content.size }
    : sentenceAt(blockText(block), $head.parentOffset);
  if (sentence) decorations.push(Decoration.inline(start + sentence.from, start + sentence.to, { class: "wFocusText" }));
  return decorations;
}

function build(state: EditorState, modes: EditorModes): ModesState {
  const focus = modes.focus ? focusDecorations(state) : [];
  return { modes, decorations: focus.length ? DecorationSet.create(state.doc, focus) : DecorationSet.empty };
}

// Focus is drawn as decorations over the document, so it never reaches the
// saved Markdown. `current` supplies the modes when the editor state is
// replaced outright, as it is on a remote change.
export function modesPlugin(current: () => EditorModes) {
  return new Plugin<ModesState>({
    key: modesKey,
    state: {
      init: (_config, state) => build(state, current()),
      apply(tr, value, _old, state) {
        const modes = (tr.getMeta(modesKey) as EditorModes | undefined) ?? value.modes;
        const moved = modes.focus && (tr.docChanged || tr.selectionSet);
        if (modes.focus === value.modes.focus && !moved) return value;
        return build(state, modes);
      }
    },
    props: {
      decorations: (state) => modesKey.getState(state)?.decorations,
      attributes: (state): Record<string, string> => (modesKey.getState(state)?.modes.focus ? { class: "wFocusOn" } : {})
    }
  });
}

// Nodes are immutable and shared between editor states, so a block that has
// not changed is counted once however long the document is edited.
const wordCache = new WeakMap<Node, number>();

function blockWords(block: Node) {
  let words = wordCache.get(block);
  if (words === undefined) {
    words = block.textContent.match(/\S+/g)?.length ?? 0;
    wordCache.set(block, words);
  }
  return words;
}

// The top-level headings in order, with the document position of each. A
// section's words run to the next heading of the same or a higher level.
export function outlineOf(doc: Node) {
  const blocks: Array<{ words: number; level: number }> = [];
  const items: OutlineItem[] = [];
  const positions: number[] = [];
  const starts: number[] = [];
  doc.forEach((block, offset) => {
    const heading = block.type.name === "heading";
    if (heading && block.textContent.trim()) {
      items.push({ level: block.attrs.level as number, text: block.textContent.trim(), words: 0 });
      positions.push(offset);
      starts.push(blocks.length);
    }
    blocks.push({ words: blockWords(block), level: heading ? block.attrs.level as number : 0 });
  });
  items.forEach((item, index) => {
    for (let at = starts[index] + 1; at < blocks.length; at += 1) {
      if (blocks[at].level && blocks[at].level <= item.level) break;
      item.words += blocks[at].words;
    }
  });
  return { items, positions };
}

export function selectionWords(state: EditorState) {
  const { empty, from, to } = state.selection;
  return empty ? 0 : state.doc.textBetween(from, to, " ", " ").match(/\S+/g)?.length ?? 0;
}
