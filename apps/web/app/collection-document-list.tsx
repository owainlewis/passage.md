"use client";

import { useState } from "react";
import { DeleteCollectionDialog } from "./editor-workspace";
import type { WorkspaceCollection } from "./editor-workspace-model";
import { editorDocTitle } from "./editor-list";
import type { Doc } from "./editor-model";
import { workspaceDocSummary } from "./editor-workspace-model";
import { PlusIcon, SearchIcon } from "./icons";

export function CollectionDocumentList({
  title, docs, activeId, mobileOpen, hasMore, loadingMore, loadError, newDisabled,
  onOpen, onOverview, onNew, onSearch, onLoadMore, collection, onDeleteCollection, deleteDisabled
}: {
  collection?: WorkspaceCollection;
  onDeleteCollection: (slug: string) => Promise<boolean>;
  deleteDisabled: boolean;
  title: string;
  docs: Doc[];
  activeId: string;
  mobileOpen: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: boolean;
  newDisabled: boolean;
  onOpen: (doc: Doc) => void;
  onOverview: () => void;
  onNew: () => void;
  onSearch: () => void;
  onLoadMore: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const canDelete = collection && collection.slug !== "documents";

  return (
    <nav className="collectionDocumentList" aria-label={`Documents in ${title}`} data-mobile-open={mobileOpen} id="collection-document-list">
      <header>
        <button className="collectionListTitle" type="button" onClick={onOverview} title="Open collection overview">{title}</button>
        <button className="iconButton" type="button" aria-label={`Search ${title}`} onClick={onSearch}><SearchIcon /></button>
        <button className="iconButton" type="button" aria-label={`New document in ${title}`} disabled={newDisabled} onClick={onNew}><PlusIcon /></button>
      </header>
      <div className="collectionListScroll">
        {docs.length === 0 && !hasMore && !loadError && <p role="status">No documents yet.</p>}
        {docs.map((doc) => (
          <button className="collectionListDocument" type="button" key={doc.id} aria-current={doc.id === activeId ? "page" : undefined} onClick={() => onOpen(doc)}>
            <strong>{editorDocTitle(doc)}</strong>
            <span>{workspaceDocSummary(doc)}</span>
          </button>
        ))}
        {loadError && <p role="status">More documents could not be loaded. Try again.</p>}
        {hasMore && <button className="collectionListMore" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Loading…" : "Load more documents"}</button>}
      </div>
      {canDelete && <div className="collectionListActions">
        <button type="button" aria-label={`Delete collection ${title}`} disabled={deleteDisabled} onClick={() => setDeleting(true)}>Delete collection</button>
      </div>}
      {canDelete && deleting && <DeleteCollectionDialog
        collection={collection}
        documentCount={docs.length}
        documentCountComplete={!hasMore && !loadError}
        onClose={() => setDeleting(false)}
        onDelete={() => onDeleteCollection(collection.slug)}
      />}
    </nav>
  );
}
