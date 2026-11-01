"use client";

import { useMemo, useRef, useState } from "react";
import { bodyAfterTitle, plainSummary, withoutLeadingTitle } from "./doc-utils";
import { relativeDate, sortByUpdated } from "./editor-drawer";
import { Doc, isShared } from "./editor-model";
import { editorDocSearchText, editorDocTitle } from "./editor-list";
import { SearchIcon } from "./icons";
import { Modal } from "./modal";
import { normalizeEditorSearch, useEditorSearch } from "./use-editor-search";

type Row = { doc: Doc; excerpt?: string };

// Before anything is typed the dialog offers the most recent documents.
const RECENT_LIMIT = 8;

/**
 * ⌘K. A search box over every document, in a dialog of its own so it works
 * the same whether the list is open or not. Typing filters titles and text
 * already loaded straight away, and full-text results from the server
 * replace them once they arrive.
 */
export function SearchDialog({
  docs,
  searchPaused,
  userId,
  onClose,
  onOpen
}: {
  docs: Doc[];
  searchPaused: boolean;
  userId?: string;
  onClose: () => void;
  onOpen: (doc: Doc) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const search = useEditorSearch({ query, userId, paused: searchPaused });
  const normalized = normalizeEditorSearch(query).toLowerCase();

  const rows = useMemo<Row[]>(() => {
    const sorted = sortByUpdated(docs);
    if (!normalized) return sorted.slice(0, RECENT_LIMIT).map((doc) => ({ doc }));
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

  function choose(row: Row | undefined) {
    if (!row) return;
    onClose();
    onOpen(row.doc);
  }

  function move(step: number) {
    const next = (selected + step + rows.length) % Math.max(rows.length, 1);
    setHighlight(next);
    list.current?.querySelectorAll(".wPaletteRow")[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <Modal ariaLabel="Search documents" variant="palette" initialFocus={input} onClose={onClose}>
      <label className="wPaletteField">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Search documents"
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
              move(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(rows[selected]);
            }
          }}
        />
        <kbd aria-hidden="true">esc</kbd>
      </label>

      <div ref={list} className="wPaletteList" role="group" aria-label="Search results">
        {!normalized && rows.length > 0 && <p className="wPaletteLabel">Recent</p>}
        {rows.map((row, index) => (
          <button
            key={row.doc.id}
            type="button"
            className="wPaletteRow"
            tabIndex={-1}
            data-highlight={index === selected || undefined}
            onMouseMove={() => setHighlight(index)}
            onClick={() => choose(row)}
          >
            <span className="wDocTitle">{editorDocTitle(row.doc)}</span>
            {row.excerpt
              ? <span className="wPaletteExcerpt">{plainSummary(row.excerpt)}</span>
              : (
                <span className="wDocMeta">
                  {isShared(row.doc) && <span className="wDocShared">Shared</span>}
                  <span>{relativeDate(row.doc.updatedAt)}</span>
                </span>
              )}
          </button>
        ))}
        {normalized && rows.length === 0 && (
          <p className="wDocEmpty" role="status">
            {search.loading ? "Searching…" : search.errorMessage || "Nothing matches that."}
          </p>
        )}
        {!normalized && docs.length === 0 && <p className="wDocEmpty">No documents yet.</p>}
        {normalized && search.hasMore && (
          <button type="button" className="wDocMore" disabled={search.loading} onClick={search.loadMore}>
            {search.loading ? "Searching…" : "More results"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// A few words either side of the first match, for a local result's summary.
function around(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return undefined;
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, index - 48)));
  return `${start > 0 ? "…" : ""}${text.slice(start, index + query.length + 120).trim()}`;
}
