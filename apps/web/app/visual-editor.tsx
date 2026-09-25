"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";
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

  const format = (name: Format) => instance.current?.format(name);
  return (
    <div className="visualEditor">
      {status === "loading" && <p className="visualEditorNotice" role="status">Opening editor…</p>}
      {(status === "unsupported" || status === "error") && (
        <div className="visualEditorNotice" role="status">
          <p>{status === "unsupported" ? "This document needs Source mode to preserve its Markdown." : "The visual editor could not continue. Your Markdown is still available in Source."}</p>
          <button type="button" onClick={onSource}>Edit source</button>
        </div>
      )}
      {status === "ready" && (
        // The dock stays at the top of the pane in long documents. It is
        // opaque so text scrolls under it rather than showing through.
        <div className="formatBarDock">
          <div className="formatBar" role="group" aria-label="Text formatting">
            <select aria-label="Paragraph style" value={formatting.heading} onChange={(event) => instance.current?.heading(Number(event.target.value))}>
              <option value={0}>Paragraph</option>
              <option value={1}>Heading 1</option>
              <option value={2}>Heading 2</option>
              <option value={3}>Heading 3</option>
              {formatting.heading > 3 && <option value={formatting.heading}>Heading {formatting.heading}</option>}
            </select>
            <button type="button" aria-label="Bold" title="Bold (⌘/Ctrl+B)" aria-pressed={formatting.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")}><strong>B</strong></button>
            <button type="button" aria-label="Italic" title="Italic (⌘/Ctrl+I)" aria-pressed={formatting.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")}><em>I</em></button>
            <button type="button" aria-label="Strikethrough" title="Strikethrough" aria-pressed={formatting.strike} onMouseDown={(event) => event.preventDefault()} onClick={() => format("strike")}><s>S</s></button>
            <button type="button" aria-label="Inline code" title="Inline code" aria-pressed={formatting.code} onMouseDown={(event) => event.preventDefault()} onClick={() => format("code")}><span className="formatCode">`</span></button>
          </div>
        </div>
      )}
      <div ref={root} hidden={status !== "ready"} />
    </div>
  );
}
