"use client";

import { Brand } from "./brand";
import { snippetOf } from "./doc-utils";
import { editorDocSearchText, editorDocTitle, editorFolderRows, visibleEditorDocs } from "./editor-list";
import { Doc, isShared, SaveState, Theme } from "./editor-model";
import { DocIcon, FolderIcon, PinIcon, SearchIcon } from "./icons";

type EditorSidebarProps = {
  active: Doc | null;
  docs: Doc[];
  docsReady: boolean;
  filter: string;
  onClearTagFilter: () => void;
  onDeleteDoc: (id: string) => void;
  onFilterChange: (value: string) => void;
  onLoadMore: () => void;
  onSelectDoc: (doc: Doc) => void;
  onSelectFolder: (folderId: string) => void;
  onTagFilterChange: (value: string) => void;
  onToggleDarkMode: () => void;
  onTogglePin: (id: string) => void;
  saveState: SaveState;
  hasMoreDocs: boolean;
  loadingMore: boolean;
  selectedFolder: string;
  sidebarOpen: boolean;
  tagFilter: string;
  theme: Theme;
};

export function EditorSidebar({
  active,
  docs,
  docsReady,
  filter,
  onClearTagFilter,
  onDeleteDoc,
  onFilterChange,
  onLoadMore,
  onSelectDoc,
  onSelectFolder,
  onTagFilterChange,
  onToggleDarkMode,
  onTogglePin,
  saveState,
  hasMoreDocs,
  loadingMore,
  selectedFolder,
  sidebarOpen,
  tagFilter,
  theme
}: EditorSidebarProps) {
  const darkActive = theme === "dark";
  const tagFilterQuery = tagFilter.trim().toLowerCase();
  const folderRows = editorFolderRows(docs, docsReady);
  const visibleDocs = visibleEditorDocs(docs, docsReady, selectedFolder, filter, tagFilter);

  return (
    <aside className="sidebar" aria-label="Documents" data-open={sidebarOpen}>
      <div className="sidebarHead">
        <Brand href="/write" />
      </div>
      <div className="filterRow">
        <div className="filterField">
          <span className="filterIcon">
            <SearchIcon />
          </span>
          <input
            className="filterInput"
            type="text"
            name="filter-documents"
            placeholder="Filter"
            aria-label="Search documents and tags"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </div>
      </div>
      <div className="folderFilter" aria-label="Folders">
        <div className="tagFilterHead">
          <span>Folders</span>
        </div>
        <div className="folderList">
          {folderRows.map((folder) => {
            const activeFolderFilter = selectedFolder === folder.id;
            const disabled = folder.count === 0;
            return (
              <div
                key={folder.id || "all-documents"}
                className={`folderRow ${activeFolderFilter ? "active" : ""} ${disabled ? "disabled" : ""}`}
              >
                <button
                  type="button"
                  className="folderRowSelect"
                  disabled={disabled}
                  aria-current={activeFolderFilter ? "page" : undefined}
                  aria-label={`Open ${folder.label} folder`}
                  onClick={() => onSelectFolder(folder.id)}
                >
                  <span className="folderRowIcon">
                    <FolderIcon />
                  </span>
                  <span className="folderRowName">{folder.label}</span>
                  <span className="folderRowCount" aria-hidden="true">
                    {folder.count}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="docListLabel">
        <span>Documents</span>
        <span className="docCount">{visibleDocs.length}</span>
      </div>
      <nav className="docList">
        {visibleDocs.map((doc) => {
          const isActive = doc.id === active?.id;
          return (
            <div key={doc.id} className={`docRow ${isActive ? "active" : ""} ${doc.pinned ? "pinned" : ""}`}>
              <button type="button" className="docRowSelect" onClick={() => onSelectDoc(doc)}>
                <span className="docRowIcon">
                  <DocIcon />
                </span>
                <span className="docRowText">
                  <span className="docRowTitle">{editorDocTitle(doc)}</span>
                  <span className="docRowSnippet">{snippetOf(editorDocSearchText(doc))}</span>
                </span>
              </button>
              <span className="docRowActions">
                <button
                  type="button"
                  className="docRowPin"
                  aria-label={doc.pinned ? "Unpin document" : "Pin document"}
                  onClick={() => onTogglePin(doc.id)}
                >
                  <PinIcon filled={Boolean(doc.pinned)} />
                </button>
                {!doc.pinned && !isShared(doc) && (
                  <button
                    type="button"
                    className="docRowDelete"
                    aria-label="Delete document"
                    onClick={() => onDeleteDoc(doc.id)}
                  >
                    ×
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {saveState === "loading" ? (
          <div className="pendingStatus" aria-hidden="true" />
        ) : visibleDocs.length === 0 && (
          <p className="docListEmpty">{docs.length === 0 ? "No documents." : "No documents match."}</p>
        )}
        {hasMoreDocs && (
          <button type="button" className="docListMore" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load more documents"}
          </button>
        )}
      </nav>
      <div className="sidebarFoot">
        <div className="tagPanel" aria-label="Filter by tag">
          <div className="tagFilterHead">
            <span>Tags</span>
            {tagFilterQuery && (
              <button type="button" className="tagFilterClear" onClick={onClearTagFilter}>
                Clear
              </button>
            )}
          </div>
          <div className="tagFilterField">
            <span className="filterIcon">
              <SearchIcon />
            </span>
            <input
              className="tagFilterInput"
              type="text"
              name="filter-tags"
              placeholder="Filter by tag"
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={(event) => onTagFilterChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onClearTagFilter();
                }
              }}
            />
          </div>
        </div>
        <div className="themeToggle">
          <span className={theme === "light" ? "themeLabel active" : "themeLabel"}>Light</span>
          <button
            type="button"
            role="switch"
            aria-checked={darkActive}
            aria-label="Dark mode"
            className={`switch ${darkActive ? "on" : ""}`}
            onClick={onToggleDarkMode}
          >
            <span className="switchKnob" />
          </button>
          <span className={theme === "dark" ? "themeLabel active" : "themeLabel"}>Dark</span>
        </div>
      </div>
    </aside>
  );
}
