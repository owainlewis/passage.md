"use client";

import { useMemo } from "react";
import { Doc, isShared } from "./editor-model";
import { editorDocTitle } from "./editor-list";
import { CloseIcon, SearchIcon } from "./icons";

/**
 * Every document in one list, newest edit first. There are no folders: the
 * list and search are the whole of navigation. Search lives in its own
 * dialog, which the field at the top of the list opens, as does ⌘K.
 */
export function DocumentDrawer({
  activeId,
  docs,
  hasMore,
  loadingMore,
  loadError,
  open,
  overlay,
  searchHint,
  onClose,
  onLoadMore,
  onOpen,
  onSearch
}: {
  activeId: string;
  docs: Doc[];
  hasMore: boolean;
  loadingMore: boolean;
  loadError: boolean;
  open: boolean;
  overlay: boolean;
  searchHint: string;
  onClose: () => void;
  onLoadMore: () => void;
  onOpen: (doc: Doc) => void;
  onSearch: () => void;
}) {
  const sorted = useMemo(() => sortByUpdated(docs), [docs]);

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
          <button type="button" className="wSearch" aria-label="Search documents" onClick={onSearch}>
            <SearchIcon />
            <span>Search</span>
            <kbd aria-hidden="true">{searchHint}</kbd>
          </button>
          {overlay && (
            <button type="button" className="wIconButton" aria-label="Close documents" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>

        <nav className="wDocList" aria-label="All documents">
          {sorted.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="wDocRow"
              aria-current={doc.id === activeId ? "page" : undefined}
              onClick={() => onOpen(doc)}
            >
              <span className="wDocTitle">{editorDocTitle(doc)}</span>
              <span className="wDocMeta">
                {isShared(doc) && <span className="wDocShared">Shared</span>}
                <span>{relativeDate(doc.updatedAt)}</span>
              </span>
            </button>
          ))}
          {docs.length === 0 && <p className="wDocEmpty">No documents yet.</p>}
          {(hasMore || loadError) && (
            <button type="button" className="wDocMore" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Loading…" : "Load more documents"}
            </button>
          )}
        </nav>
      </aside>
    </>
  );
}

export function sortByUpdated(docs: Doc[]) {
  return [...docs].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
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
