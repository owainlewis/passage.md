"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { BoldIcon, ItalicIcon, StrikethroughIcon, InlineCodeIcon } from "./icons";
import type { Format, Formatting, VisualEditorHandle } from "./visual-editor-runtime";
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
  const toolbar = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const toolbarId = useId();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsPosition, setToolsPosition] = useState({ left: 0, top: 0 });
  const manualTools = useRef(false);
  const dismissedSelection = useRef<Range | null>(null);
  const instance = useRef<VisualEditorHandle | null>(null);
  const latest = useRef({ source, onChange });
  const wantsFocus = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported" | "error">("loading");
  const [formatting, setFormatting] = useState<Formatting>({ bold: false, italic: false, strike: false, code: false, heading: 0 });

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
        }, (value) => { if (!cancelled) setFormatting(value); }, () => {
          if (!cancelled) setStatus("error");
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

  const closeTools = useCallback(() => {
    const selection = window.getSelection();
    dismissedSelection.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    manualTools.current = false;
    setToolsOpen(false);
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    function updateTools() {
      const selection = window.getSelection();
      const selected = selection && !selection.isCollapsed && selection.rangeCount > 0
        && root.current?.contains(selection.anchorNode) && root.current?.contains(selection.focusNode);
      const range = selected ? selection.getRangeAt(0) : null;
      const dismissed = dismissedSelection.current;
      if (range && dismissed && range.startContainer === dismissed.startContainer && range.startOffset === dismissed.startOffset
        && range.endContainer === dismissed.endContainer && range.endOffset === dismissed.endOffset) return;
      dismissedSelection.current = null;
      if (toolbar.current?.contains(document.activeElement)) return;
      if (!selected && !manualTools.current) { setToolsOpen(false); return; }
      const rect = selected ? selection.getRangeAt(0).getBoundingClientRect() : trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const pane = root.current?.closest(".writingPane");
      const paneTop = pane?.getBoundingClientRect().top ?? 0;
      // Hide a selection's tools when its text leaves the visible writing pane.
      if (rect.bottom < paneTop || rect.top > window.innerHeight) { setToolsOpen(false); return; }
      const width = Math.min(320, window.innerWidth - 24);
      setToolsPosition({
        left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)),
        top: Math.max(paneTop + 8, Math.min(rect.top - 60 >= paneTop + 8 ? rect.top - 60 : rect.bottom + 8, window.innerHeight - 64))
      });
      setToolsOpen(true);
    }
    function dismiss(event: PointerEvent) {
      if (toolbar.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node)) return;
      closeTools();
    }
    document.addEventListener("selectionchange", updateTools);
    document.addEventListener("scroll", updateTools, true);
    window.addEventListener("resize", updateTools);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("selectionchange", updateTools);
      document.removeEventListener("scroll", updateTools, true);
      window.removeEventListener("resize", updateTools);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [status, closeTools]);

  function toggleTools() {
    if (toolsOpen) { closeTools(); return; }
    dismissedSelection.current = null;
    const rect = trigger.current!.getBoundingClientRect();
    manualTools.current = true;
    setToolsPosition({ left: Math.max(12, Math.min(rect.right - 320, window.innerWidth - 332)), top: rect.bottom + 8 });
    setToolsOpen(true);
  }

  const format = (name: Format) => instance.current?.format(name);
  return (
    <div className="visualEditor" onKeyDown={(event) => {
      if (event.key === "Escape" && toolsOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeTools();
        if (toolbar.current?.contains(document.activeElement)) trigger.current?.focus();
      }
    }}>
      {status === "loading" && <p className="visualEditorNotice" role="status">Opening editor…</p>}
      {(status === "unsupported" || status === "error") && (
        <div className="visualEditorNotice" role="status">
          <p>{status === "unsupported" ? "This document needs Source mode to preserve its Markdown." : "The visual editor could not continue. Your Markdown is still available in Source."}</p>
          <button type="button" onClick={onSource}>Edit source</button>
        </div>
      )}
      {status === "ready" && (
        <div className="formatBarDock">
          <button ref={trigger} type="button" className="formatBarTrigger" aria-label="Format text" title="Format text" aria-expanded={toolsOpen} aria-controls={toolbarId} onMouseDown={(event) => event.preventDefault()} onClick={toggleTools}>Aa</button>
          <div ref={toolbar} id={toolbarId} className="formatBar" role="group" aria-label="Text formatting" hidden={!toolsOpen} style={toolsPosition}>
            <select aria-label="Paragraph style" value={formatting.heading} onChange={(event) => instance.current?.heading(Number(event.target.value))}>
              <option value={0}>Paragraph</option>
              <option value={1}>Heading 1</option>
              <option value={2}>Heading 2</option>
              <option value={3}>Heading 3</option>
              {formatting.heading > 3 && <option value={formatting.heading}>Heading {formatting.heading}</option>}
            </select>
            <span className="formatBarDivider" aria-hidden="true" />
            <button type="button" aria-label="Bold" title="Bold (⌘/Ctrl+B)" aria-pressed={formatting.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")}><BoldIcon /></button>
            <button type="button" aria-label="Italic" title="Italic (⌘/Ctrl+I)" aria-pressed={formatting.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")}><ItalicIcon /></button>
            <button type="button" aria-label="Strikethrough" title="Strikethrough" aria-pressed={formatting.strike} onMouseDown={(event) => event.preventDefault()} onClick={() => format("strike")}><StrikethroughIcon /></button>
            <button type="button" aria-label="Inline code" title="Inline code" aria-pressed={formatting.code} onMouseDown={(event) => event.preventDefault()} onClick={() => format("code")}><InlineCodeIcon /></button>
          </div>
        </div>
      )}
      <div ref={root} hidden={status !== "ready"} />
    </div>
  );
}
