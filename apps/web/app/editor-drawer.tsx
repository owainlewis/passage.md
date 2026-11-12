"use client";

import { useMemo, useState } from "react";
import { Doc, isShared } from "./editor-model";
import { editorDocTitle } from "./editor-list";
import { CloseIcon, SearchIcon } from "./icons";

/**
 * Every document in one list, newest edit first. There are no folders: the
 * list and search are the whole of navigation. Search lives in its own
 * dialog, which the field at the top of the list opens, as does ⌘K.
 *
 * A document's derived docs sit one level under it, in a group that stays
 * closed until it is opened or holds the open document.
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
  const groups = useMemo(() => groupDocs(docs), [docs]);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  // Opening a document opens the group it belongs to. Tracked during render
  // rather than in an effect, so the list never paints with the open document
  // hidden inside a closed group.
  const activeGroup = groups.find((group) => (
    group.children.length > 0 && (group.doc.id === activeId || group.children.some((child) => child.id === activeId))
  ))?.doc.id ?? "";
  const revealKey = `${activeId} ${activeGroup}`;
  const [revealed, setRevealed] = useState("");
  if (revealed !== revealKey) {
    setRevealed(revealKey);
    if (activeGroup && !openGroups.has(activeGroup)) setOpenGroups(new Set(openGroups).add(activeGroup));
  }

  function toggleGroup(id: string) {
    const next = new Set(openGroups);
    if (!next.delete(id)) next.add(id);
    setOpenGroups(next);
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
          {groups.map(({ doc, children }) => {
            const row = (
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
            );
            if (children.length === 0) return row;
            const expanded = openGroups.has(doc.id);
            const title = editorDocTitle(doc);
            const count = children.length === 1 ? "1 derived doc" : `${children.length} derived docs`;
            return (
              <div key={doc.id} className="wDocGroup">
                <div className="wDocParent" data-current={doc.id === activeId || undefined}>
                  {row}
                  <button
                    type="button"
                    className="wDocToggle"
                    aria-expanded={expanded}
                    aria-controls={expanded ? `derived-${doc.id}` : undefined}
                    aria-label={`${count} of ${title}`}
                    title={count}
                    onClick={() => toggleGroup(doc.id)}
                  >
                    {children.length}
                  </button>
                </div>
                {expanded && (
                  <div id={`derived-${doc.id}`} className="wDocChildren" role="group" aria-label={`Derived from ${title}`}>
                    {children.map((child) => {
                      const childTitle = editorDocTitle(child);
                      return (
                        <button
                          key={child.id}
                          type="button"
                          className="wDocRow wDocChild"
                          title={childTitle}
                          aria-current={child.id === activeId ? "page" : undefined}
                          onClick={() => onOpen(child)}
                        >
                          <span className="wDocTitle">{childTitle}</span>
                          {isShared(child) && <span className="wDocMeta"><span className="wDocShared">Shared</span></span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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

export type DocGroup = { doc: Doc; children: Doc[] };

/**
 * Top-level documents newest edit first, each with its derived docs oldest
 * first. A derived doc whose parent is not in the list yet, because that page
 * has not loaded, stands as its own row until it is.
 */
export function groupDocs(docs: Doc[]): DocGroup[] {
  const ids = new Set(docs.map((doc) => doc.id));
  const children = new Map<string, Doc[]>();
  const top: Doc[] = [];
  for (const doc of docs) {
    if (!doc.parentId || !ids.has(doc.parentId)) {
      top.push(doc);
      continue;
    }
    children.set(doc.parentId, [...(children.get(doc.parentId) ?? []), doc]);
  }
  return sortByUpdated(top).map((doc) => ({
    doc,
    children: (children.get(doc.id) ?? []).sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt))
  }));
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
