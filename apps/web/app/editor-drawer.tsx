"use client";

import { RefObject, useMemo, useState } from "react";
import { bodyAfterTitle, plainSummary, withoutLeadingTitle } from "./doc-utils";
import { Doc, isShared } from "./editor-model";
import { editorDocSearchText, editorDocTitle } from "./editor-list";
import { CloseIcon, SearchIcon } from "./icons";
import { normalizeEditorSearch, useEditorSearch } from "./use-editor-search";

type Row = { doc: Doc; excerpt?: string };

/**
 * Every document in one list, newest edit first, with search at the top.
 * There are no folders: the list and the search box are the whole of
 * navigation. Typing filters titles and text already loaded straight away,
 * and full-text results from the server replace them once they arrive.
 */
export function DocumentDrawer({
  activeId,
  docs,
  hasMore,
  loadingMore,
  loadError,
  open,
  overlay,
  searchInput,
  searchPaused,
  userId,
  onClose,
  onLoadMore,
  onOpen
}: {
  activeId: string;
  docs: Doc[];
  hasMore: boolean;
  loadingMore: boolean;
  loadError: boolean;
  open: boolean;
  overlay: boolean;
  searchInput: RefObject<HTMLInputElement | null>;
  searchPaused: boolean;
  userId?: string;
  onClose: () => void;
  onLoadMore: () => void;
  onOpen: (doc: Doc) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const search = useEditorSearch({ query, userId, paused: searchPaused });
  const normalized = normalizeEditorSearch(query).toLowerCase();

  const rows = useMemo<Row[]>(() => {
    const sorted = [...docs].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
    if (!normalized) return sorted.map((doc) => ({ doc }));
    // Server results come first, ranked by full text. Loaded documents that
    // contain the words as typed follow, so a partial word still finds them.
    const server = search.documents.map((doc) => {
      const known = docs.find((candidate) => candidate.id === doc.id);
      const merged = known ? { ...doc, body: known.body, bodyLoaded: known.bodyLoaded } : doc;
      return { doc: merged, excerpt: withoutLeadingTitle(doc.matchExcerpt, editorDocTitle(merged)) || undefined };
    });
    const found = new Set(server.map((row) => row.doc.id));
    const local = sorted
      .filter((doc) => !found.has(doc.id))
      .filter((doc) => `${editorDocTitle(doc)}\n${editorDocSearchText(doc)}`.toLowerCase().includes(normalized))
      .map((doc) => ({ doc, excerpt: around(bodyAfterTitle(editorDocSearchText(doc)) ?? "", normalized) }));
    return [...server, ...local];
  }, [docs, normalized, search.documents]);

  const selected = Math.min(highlight, Math.max(rows.length - 1, 0));

  function openRow(row: Row | undefined) {
    if (!row) return;
    onOpen(row.doc);
  }

  return (
    <>
      {overlay && open && <div className="wScrim" aria-hidden="true" onClick={onClose} />}
      <aside
        className="wDrawer"
        data-open={open}
        aria-label="Documents"
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
      >
        <div className="wDrawerHead">
          <label className="wSearch">
            <SearchIcon />
            <input
              ref={searchInput}
              type="search"
              value={query}
              placeholder="Search"
              aria-label="Search documents"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setHighlight((selected + step + rows.length) % Math.max(rows.length, 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  openRow(rows[selected]);
                } else if (event.key === "Escape") {
                  if (query) {
                    event.stopPropagation();
                    setQuery("");
                  } else {
                    onClose();
                  }
                }
              }}
            />
            <kbd aria-hidden="true">⌘K</kbd>
          </label>
          {overlay && (
            <button type="button" className="wIconButton" aria-label="Close documents" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>

        <nav className="wDocList" aria-label="All documents">
          {rows.map((row, index) => (
            <button
              key={row.doc.id}
              type="button"
              className="wDocRow"
              aria-current={row.doc.id === activeId ? "page" : undefined}
              data-highlight={normalized && index === selected ? true : undefined}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => openRow(row)}
            >
              <span className="wDocHead">
                <span className="wDocTitle">{editorDocTitle(row.doc)}</span>
                {isShared(row.doc) && <span className="wDocShared">Shared</span>}
              </span>
              {row.excerpt
                ? <span className="wDocExcerpt">{plainSummary(row.excerpt)}</span>
                : <span className="wDocMeta">{relativeDate(row.doc.updatedAt)}</span>}
            </button>
          ))}
          {normalized && rows.length === 0 && (
            <p className="wDocEmpty" role="status">
              {search.loading ? "Searching…" : search.errorMessage || "Nothing matches that."}
            </p>
          )}
          {!normalized && docs.length === 0 && <p className="wDocEmpty">No documents yet.</p>}
          {!normalized && (hasMore || loadError) && (
            <button type="button" className="wDocMore" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Loading…" : "Load more documents"}
            </button>
          )}
          {normalized && search.hasMore && (
            <button type="button" className="wDocMore" disabled={search.loading} onClick={search.loadMore}>
              {search.loading ? "Searching…" : "More results"}
            </button>
          )}
        </nav>
      </aside>
    </>
  );
}

// A few words either side of the first match, for a local result's summary.
function around(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return undefined;
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, index - 48)));
  return `${start > 0 ? "…" : ""}${text.slice(start, index + query.length + 120).trim()}`;
}

function timestamp(value?: string) {
  return value ? Date.parse(value) || 0 : 0;
}

const DAY = 24 * 60 * 60 * 1000;

export function relativeDate(value?: string, now = Date.now()) {
  const time = timestamp(value);
  if (!time) return "";
  const elapsed = now - time;
  if (elapsed < 60 * 1000) return "Just now";
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)} min ago`;
  const date = new Date(time);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (new Date(now - DAY).toDateString() === date.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  });
}
