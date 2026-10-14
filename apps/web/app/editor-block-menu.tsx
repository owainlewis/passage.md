"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { matchingBlockCommands, type BlockCommand } from "./editor-block-commands";
import type { BlockMenuState } from "./visual-editor-runtime";

export function EditorBlockMenu({ id, state, selected, onSelect, onHighlight }: {
  id: string;
  state: BlockMenuState;
  selected: number;
  onSelect: (command: BlockCommand) => void;
  onHighlight: (index: number) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const commands = matchingBlockCommands(state.query);
  const maxHeight = Math.min(360, window.innerHeight - 24);
  const width = Math.min(300, window.innerWidth - 24);
  const left = Math.max(12, Math.min(state.left, window.innerWidth - width - 12));
  const top = state.top + 8 + maxHeight <= window.innerHeight - 12
    ? state.top + 8
    : Math.max(12, state.top - maxHeight - 24);

  useEffect(() => {
    menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  return createPortal(
    <div className="blockCommandMenu" style={{ left, top, width, maxHeight }}>
      <div ref={menu} id={id} role="listbox" aria-label="Insert block" className="blockCommandOptions">
        {commands.map((command, index) => (
          <button
            key={command.id}
            id={`${id}-${command.id}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-label={command.label}
            aria-selected={selected === index}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => onHighlight(index)}
            onClick={() => onSelect(command.id)}
          >
            <strong>{command.label}</strong>
            <span>{command.description}</span>
          </button>
        ))}
        {commands.length === 0 && <p role="status">No matching blocks. Try “heading” or “list”.</p>}
      </div>
      <p className="blockCommandHint">Arrow keys to choose · Enter to insert · Esc to close</p>
    </div>,
    document.body
  );
}
