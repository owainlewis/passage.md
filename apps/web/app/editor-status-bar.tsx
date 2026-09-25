"use client";

import { saveLabel, SaveState } from "./editor-model";

export function EditorStatusBar({ saveState, showSaveState, words, copied }: {
  saveState: SaveState;
  showSaveState: boolean;
  words: number;
  copied: boolean;
}) {
  return (
    <footer className="editorStatus" aria-label="Editor status">
      <span>{words === 1 ? "1 word" : `${words} words`}</span>
      {showSaveState && <span role="status">{saveLabel(saveState)}</span>}
      <span role="status">{copied ? "Copied" : ""}</span>
    </footer>
  );
}
