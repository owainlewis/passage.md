"use client";

import Link from "next/link";
import { Mode, saveLabel, SaveState, ShareState } from "./editor-model";
import { DownloadIcon, EyeIcon, PencilIcon, SaveStatusIcon, ShareIcon } from "./icons";

type EditorStatusBarProps = {
  activeShared: boolean;
  mode: Mode;
  onExport: () => void;
  onModeChange: (mode: Mode) => void;
  onShare: () => void;
  onUnshare: () => void;
  publicDocPath: string;
  saveState: SaveState;
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
  onShare,
  onUnshare,
  publicDocPath,
  saveState,
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
            aria-pressed={activeShared}
            onClick={() => void (activeShared ? onUnshare() : onShare())}
            title={
              shareState === "toolong"
                ? "This document is too long to share as a link"
                : activeShared
                  ? "Click to unshare"
                  : undefined
            }
          >
            <ShareIcon />
            <span>{shareButtonLabel}</span>
          </button>
          {publicDocPath && (
            <Link
              className="dockButton publicDocLink"
              href={publicDocPath}
              target="_blank"
              rel="noreferrer"
              aria-label="Open public document"
            >
              <EyeIcon />
              <span>View</span>
            </Link>
          )}
          <button type="button" className="dockButton" onClick={onExport}>
            <DownloadIcon />
            <span>Export</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
