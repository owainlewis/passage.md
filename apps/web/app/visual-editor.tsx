"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { EditorBlockMenu } from "./editor-block-menu";
import { matchingBlockCommands } from "./editor-block-commands";
import type { BlockMenuState, VisualEditorHandle } from "./visual-editor-runtime";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "@milkdown/kit/prose/gapcursor/style/gapcursor.css";
import "@milkdown/kit/prose/tables/style/tables.css";

type Props = {
  source: string;
  onChange: (source: string) => void;
  onSource: () => void;
  ref?: Ref<{ focus: () => void }>;
};

export function VisualEditor({ source, onChange, onSource, ref }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [blockMenu, setBlockMenu] = useState<BlockMenuState | null>(null);
  const [selectedBlock, setSelectedBlock] = useState(0);
  const blockState = useRef<{ menu: BlockMenuState | null; selected: number }>({ menu: null, selected: 0 });
  const instance = useRef<VisualEditorHandle | null>(null);
  const latest = useRef({ source, onChange });
  const wantsFocus = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported" | "error">("loading");

  useImperativeHandle(ref, () => ({ focus() {
    wantsFocus.current = true;
    instance.current?.focus();
  } }), []);

  useLayoutEffect(() => {
    latest.current = { source, onChange };
  }, [source, onChange]);

  useEffect(() => {
    let cancelled = false;
    let handle: VisualEditorHandle | undefined;
    // Each mount gets its own host so an unfinished Strict Mode mount cannot
    // remove or duplicate a newer editor when its async setup finishes.
    const host = document.createElement("div");
    root.current!.appendChild(host);
    void import("./visual-editor-runtime").then(async ({ createVisualEditor, UnsupportedMarkdown }) => {
      if (cancelled) return;
      try {
        handle = await createVisualEditor(host, latest.current.source, (value) => {
          if (!cancelled) latest.current.onChange(value);
        }, () => {
          if (!cancelled) setStatus("error");
        }, {
          onChange(value) {
            if (cancelled) return;
            if (value?.query !== blockState.current.menu?.query) blockState.current.selected = 0;
            blockState.current.menu = value;
            setBlockMenu(value);
            setSelectedBlock(blockState.current.selected);
          },
          onKeyDown(event) {
            if (cancelled || !blockState.current.menu) return false;
            const commands = matchingBlockCommands(blockState.current.menu.query);
            if (event.key === "Escape" || event.key === "Tab") {
              instance.current?.dismissBlocks();
              return event.key === "Escape";
            }
            if (!commands.length) return false;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              const index = blockState.current.selected;
              blockState.current.selected = event.key === "Home" ? 0 : event.key === "End" ? commands.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length;
              setSelectedBlock(blockState.current.selected);
              return true;
            }
            if (event.key === "Enter") {
              return instance.current?.insertBlock(commands[blockState.current.selected].id) ?? false;
            }
            return false;
          }
        });
        if (cancelled) { await handle.destroy(); return; }
        handle.setSource(latest.current.source);
        instance.current = handle;
        setStatus("ready");
        if (wantsFocus.current) handle.focus();
      } catch (error) {
        if (!cancelled) setStatus(error instanceof UnsupportedMarkdown ? "unsupported" : "error");
      }
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => {
      cancelled = true;
      instance.current = null;
      if (handle) void handle.destroy();
      host.remove();
    };
  }, []);

  useEffect(() => {
    try {
      instance.current?.setSource(source);
    } catch {
      // Keep the incoming source in the parent. Never save a partial parse.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("unsupported");
    }
  }, [source]);

  useEffect(() => {
    const command = blockMenu ? matchingBlockCommands(blockMenu.query)[selectedBlock] : undefined;
    instance.current?.setBlockSelection(blockMenu ? menuId : null, command ? `${menuId}-${command.id}` : null);
  }, [blockMenu, menuId, selectedBlock]);

  return (
    <div className="visualEditor">
      {status === "loading" && <p className="visualEditorNotice" role="status">Opening editor…</p>}
      {(status === "unsupported" || status === "error") && (
        <div className="visualEditorNotice" role="status">
          <p>{status === "unsupported" ? "This document needs Source mode to preserve its Markdown." : "The visual editor could not continue. Your Markdown is still available in Source."}</p>
          <button type="button" onClick={onSource}>Edit source</button>
        </div>
      )}
      <div ref={root} hidden={status !== "ready"} />
      {status === "ready" && blockMenu && <EditorBlockMenu
        id={menuId}
        state={blockMenu}
        selected={selectedBlock}
        onHighlight={(index) => { blockState.current.selected = index; setSelectedBlock(index); }}
        onSelect={(command) => instance.current?.insertBlock(command)}
      />}
    </div>
  );
}
