"use client";

import { Brand } from "./brand";
import { snippetOf } from "./doc-utils";
import { editorDocSearchText, editorDocTitle, visibleEditorDocs } from "./editor-list";
import { Doc, DocumentFilter, isShared, SaveState, Theme } from "./editor-model";
import { DocIcon, PinIcon, SearchIcon, ShareIcon } from "./icons";

type EditorSidebarProps = {
  active: Doc | null;
  docs: Doc[];
  docsReady: boolean;
  filter: string;
  onClearTagFilter: () => void;
  onDeleteDoc: (id: string) => void;
  onDocumentFilterChange: (filter: DocumentFilter) => void;
  onFilterChange: (value: string) => void;
  onLoadMore: () => void;
  onOpenTemplates: () => void;
  onSelectDoc: (doc: Doc) => void;
  onTagFilterChange: (value: string) => void;
  onToggleDarkMode: () => void;
  onTogglePin: (id: string) => void;
  saveState: SaveState;
  hasMoreDocs: boolean;
  loadingMore: boolean;
  documentFilter: DocumentFilter;
  sidebarOpen: boolean;
  tagFilter: string;
  templateCount: number;
  templatesActive: boolean;
  theme: Theme;
};

export function EditorSidebar({
  active,
  docs,
  docsReady,
  filter,
  onClearTagFilter,
  onDeleteDoc,
  onDocumentFilterChange,
  onFilterChange,
  onLoadMore,
  onOpenTemplates,
  onSelectDoc,
  onTagFilterChange,
  onToggleDarkMode,
  onTogglePin,
  saveState,
  hasMoreDocs,
  loadingMore,
  documentFilter,
  sidebarOpen,
  tagFilter,
  templateCount,
  templatesActive,
  theme
}: EditorSidebarProps) {
  const darkActive = theme === "dark";
  const tagFilterQuery = tagFilter.trim().toLowerCase();
  const visibleDocs = visibleEditorDocs(docs, docsReady, documentFilter, filter, tagFilter);

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
      <div className="sidebarShortcuts">
        <button
          type="button"
          className={`templateSidebarButton ${templatesActive ? "active" : ""}`}
          aria-current={templatesActive ? "page" : undefined}
          onClick={onOpenTemplates}
        >
          <span className="templateSidebarIcon"><DocIcon /></span>
          <span className="templateSidebarName">Templates</span>
          <span className="templateSidebarCount" aria-hidden="true">{templateCount}/10</span>
        </button>
      </div>
      <div className="docListLabel">
        <span>Documents</span>
        <div className="docListControls">
          <select
            className="documentFilter"
            aria-label="Filter documents by sharing"
            value={documentFilter}
            onChange={(event) => onDocumentFilterChange(event.target.value as DocumentFilter)}
          >
            <option value="all">All</option>
            <option value="private">Private</option>
            <option value="shared">Shared</option>
          </select>
          <span className="docCount">{visibleDocs.length}</span>
        </div>
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
                  <span className="docRowTitle">
                    <span className="docRowTitleText">{editorDocTitle(doc)}</span>
                    {isShared(doc) && (
                      <span className="docSharedMark" aria-label="Shared document" title="Shared">
                        <ShareIcon />
                      </span>
                    )}
                  </span>
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
