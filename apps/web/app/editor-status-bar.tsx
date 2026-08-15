"use client";

import { Mode, saveLabel, SaveState, ShareState } from "./editor-model";
import { DownloadIcon, EyeIcon, PencilIcon, SaveStatusIcon, ShareIcon } from "./icons";

type EditorStatusBarProps = {
  activeShared: boolean;
  mode: Mode;
  onExport: () => void;
  onModeChange: (mode: Mode) => void;
  onOpenShare: () => void;
  saveState: SaveState;
  shareDialogOpen: boolean;
  shareButtonLabel: string;
  shareState: ShareState;
  showSaveState: boolean;
  words: number;
};

export function EditorStatusBar({
  activeShared,
  mode,
  onExport,
  onModeChange,
  onOpenShare,
  saveState,
  shareDialogOpen,
  shareButtonLabel,
  shareState,
  showSaveState,
  words
}: EditorStatusBarProps) {
  return (
    <footer className="statusBar" aria-label="Editor status">
      <div className="statusDock">
        <div className="dockGroup dockGroupMode">
          <div className="modeToggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={mode === "edit" ? "on" : ""}
              aria-pressed={mode === "edit"}
              onClick={() => onModeChange("edit")}
            >
              <PencilIcon />
              <span>Edit</span>
            </button>
            <button
              type="button"
              className={mode === "preview" ? "on" : ""}
              aria-pressed={mode === "preview"}
              onClick={() => onModeChange("preview")}
            >
              <EyeIcon />
              <span>Preview</span>
            </button>
          </div>
        </div>
        <div className="dockGroup dockGroupMeta">
          {showSaveState && (
            <span className="statusPill statusSave">
              <SaveStatusIcon />
              {saveLabel(saveState)}
            </span>
          )}
          <span className="statusPill">{words === 1 ? "1 word" : `${words} words`}</span>
        </div>
        <div className="dockGroup dockGroupActions">
          <button
            type="button"
            className="dockButton shareToggle"
            aria-expanded={shareDialogOpen}
            aria-haspopup="dialog"
            aria-pressed={activeShared}
            onClick={onOpenShare}
            title={shareState === "toolong" ? "This document is too long to share as a link" : undefined}
          >
            <ShareIcon />
            <span>{shareButtonLabel}</span>
          </button>
          <button type="button" className="dockButton" onClick={onExport}>
            <DownloadIcon />
            <span>Export</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
