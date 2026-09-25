"use client";

import { useEffect, useRef, useState } from "react";
import type { Mode, ShareState } from "./editor-model";
import { FocusIcon, MoreIcon, ShareIcon } from "./icons";

type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete?: () => void;
  deleteDisabled: boolean;
  onCopyLink?: () => void;
  onShare: () => void;
  shareLabel: string;
  shareState: ShareState;
  shareOpen: boolean;
};

export function EditorControls(props: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function act(action: () => void) {
    close();
    action();
  }

  return (
    <header className="editorControls" aria-label="Document controls">
      <div className="editorModes" role="group" aria-label="View mode">
        {([ ["write", "Write"], ["edit", "Source"], ["preview", "Preview"] ] as const).map(([mode, label]) => (
          <button key={mode} type="button" aria-pressed={props.mode === mode} onClick={() => props.onModeChange(mode)}>{label}</button>
        ))}
      </div>
      <div className="editorControlActions">
        <button type="button" className="editorFocus" aria-label={props.focusMode ? "Exit focus mode" : "Enter focus mode"} aria-pressed={props.focusMode} title={props.focusMode ? "Exit focus mode" : "Focus mode"} onClick={props.onToggleFocus}>
          <FocusIcon /><span>{props.focusMode ? "Exit focus" : "Focus"}</span>
        </button>
        <button type="button" className="editorShare" aria-label={props.shareLabel} aria-haspopup="dialog" aria-expanded={props.shareOpen} title={props.shareState === "toolong" ? "This document is too long to share as a link" : props.shareLabel} onClick={props.onShare}>
          <ShareIcon /><span>{props.shareLabel}</span>
        </button>
        <div ref={wrap} className="documentActions" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}>
          <button ref={trigger} type="button" aria-label="Document actions" title="Document actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "document-actions-menu" : undefined} onClick={() => setOpen(!open)} onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
          }}><MoreIcon /></button>
          {open && <div ref={menu} className="documentActionsMenu" id="document-actions-menu" role="menu" aria-label="Document actions" onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
            const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : -1;
            if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
          }}>
            <button role="menuitem" type="button" onClick={() => act(props.onCopy)}>Copy Markdown</button>
            <button role="menuitem" type="button" onClick={() => act(props.onExport)}>Export Markdown</button>
            {props.onCopyLink && <button role="menuitem" type="button" onClick={() => act(props.onCopyLink!)}>Copy link</button>}
            {props.onDelete && <button role="menuitem" type="button" className="documentActionDelete" disabled={props.deleteDisabled} onClick={() => act(props.onDelete!)}>Delete document</button>}
          </div>}
        </div>
      </div>
    </header>
  );
}
