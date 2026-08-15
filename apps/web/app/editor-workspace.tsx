"use client";

import { FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchDocument } from "./editor-api";
import { editorDocTitle } from "./editor-list";
import { Doc, SaveState } from "./editor-model";
import {
  collectionForDoc,
  collectionLabel,
  docsInCollection,
  recentDocs,
  searchWorkspaceDocs,
  WORKSPACE_COLLECTIONS,
  WorkspaceCollection,
  WorkspaceView,
  workspaceDocSummary
} from "./editor-workspace-model";
import { DocIcon, SearchIcon, StarIcon } from "./icons";
import { useEditorSearch } from "./use-editor-search";

type EditorWorkspaceProps = {
  assignments: Record<string, string>;
  assignmentDisabled: boolean;
  collectionAvailable: boolean;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  saveState: SaveState;
  view: WorkspaceView;
  onAssignCollection: (id: string, slug: string) => Promise<boolean>;
  onCreateCollection: (title: string, description: string) => Promise<boolean>;
  onDeleteCollection: (slug: string) => Promise<boolean>;
  onOpenCollection: (slug: string) => void;
  onOpenDocument: (doc: Doc) => void;
  onOpenSearch: (scope?: string) => void;
  onOpenView: (view: WorkspaceView) => void;
  onUpdateCollection: (slug: string, title: string, description: string) => Promise<boolean>;
  hasMoreDocs: boolean;
  loadingMore: boolean;
  onLoadMoreDocs: () => void;
  onToggleStar: (id: string) => Promise<boolean>;
  pendingCollectionSlugs: Set<string>;
  pendingDocIds: Set<string>;
};

export function EditorWorkspace({
  assignments,
  assignmentDisabled,
  collectionAvailable,
  collections,
  docs,
  deletedCollections,
  saveState,
  view,
  onAssignCollection,
  onCreateCollection,
  onDeleteCollection,
  onOpenCollection,
  onOpenDocument,
  onOpenSearch,
  onOpenView,
  onUpdateCollection,
  hasMoreDocs,
  loadingMore,
  onLoadMoreDocs,
  onToggleStar,
  pendingCollectionSlugs,
  pendingDocIds
}: EditorWorkspaceProps) {
  if (view.type === "document" || view.type === "templates") return null;

  if (saveState === "loading") {
    return <div className="workspaceHub workspaceHubLoading" role="status" aria-label="Loading saved docs" />;
  }

  let content: React.ReactNode;

  if (view.type === "home") {
    content = (
      <WorkspaceHome
        assignments={assignments}
        collections={collections}
        docs={docs}
        deletedCollections={deletedCollections}
        onOpenCollection={onOpenCollection}
        onOpenDocument={onOpenDocument}
        onOpenSearch={onOpenSearch}
        onOpenView={onOpenView}
      />
    );
  } else if (view.type === "collections") {
    content = (
      <WorkspaceCollections
        key={view.createRequest ?? "collections"}
        assignments={assignments}
        collections={collections}
        docs={docs}
        deletedCollections={deletedCollections}
        initialCreating={Boolean(view.createRequest)}
        onCreateCollection={onCreateCollection}
        onOpenCollection={onOpenCollection}
      />
    );
  } else if (view.type === "collection") {
    const collection = collections.find((item) => item.slug === view.slug);
    content = collection ? (
      <WorkspaceCollectionView
        assignments={assignments}
        assignmentDisabled={assignmentDisabled}
        collection={collection}
        docs={docsInCollection(docs, collection.slug, assignments, deletedCollections)}
        onAssignCollection={onAssignCollection}
        onDeleteCollection={onDeleteCollection}
        onOpenDocument={onOpenDocument}
        onOpenSearch={() => onOpenSearch(collection.slug)}
        onToggleStar={onToggleStar}
        onUpdateCollection={onUpdateCollection}
        collections={collections}
        deletedCollections={deletedCollections}
        pendingCollectionSlugs={pendingCollectionSlugs}
        pendingDocIds={pendingDocIds}
        collectionCountComplete={!hasMoreDocs}
      />
    ) : (
      <div className="workspaceHub" aria-label="Collection unavailable">
        <header className="workspaceHero">
          <h1>{collectionAvailable ? "Collection could not be found" : "Collection could not be loaded"}</h1>
          <p>{collectionAvailable
            ? "Choose another collection from the workspace."
            : "This link has been kept. Reload to try again."}</p>
        </header>
      </div>
    );
  } else {
    const list = view.type === "starred" ? docs.filter((doc) => doc.pinned) : recentDocs(docs);
    content = (
      <WorkspaceList
        assignments={assignments}
        assignmentDisabled={assignmentDisabled}
        collections={collections}
        docs={list}
        deletedCollections={deletedCollections}
        title={view.type === "starred" ? "Starred" : "Recent"}
        description={
          view.type === "starred"
            ? "The documents you return to most often. Stars are personal and do not change agent access."
            : "Your latest Markdown, ordered by its most recent saved update."
        }
        empty={view.type === "starred" ? "Star a document to keep it close." : "No recent documents yet."}
        onAssignCollection={onAssignCollection}
        onOpenDocument={onOpenDocument}
        onToggleStar={onToggleStar}
        pendingDocIds={pendingDocIds}
      />
    );
  }

  return (
    <>
      {content}
      {hasMoreDocs && (
        <div className="workspaceLoadMore">
          <button type="button" disabled={loadingMore} onClick={onLoadMoreDocs}>
            {loadingMore ? "Loading documents…" : "Load more documents"}
          </button>
        </div>
      )}
    </>
  );
}

function WorkspaceHome({
  assignments,
  collections,
  docs,
  deletedCollections,
  onOpenCollection,
  onOpenDocument,
  onOpenSearch,
  onOpenView
}: {
  assignments: Record<string, string>;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  onOpenCollection: (slug: string) => void;
  onOpenDocument: (doc: Doc) => void;
  onOpenSearch: () => void;
  onOpenView: (view: WorkspaceView) => void;
}) {
  const starred = docs.filter((doc) => doc.pinned).slice(0, 4);
  const recent = recentDocs(docs).slice(0, 6);

  return (
    <div className="workspaceHub workspaceHome" aria-label="Workspace home">
      <header className="workspaceHero">
        <h1>Documents</h1>
        <p>Markdown, organised for writing and reuse.</p>
        <div className="workspaceHeroActions">
          <button type="button" className="workspaceSearchButton" onClick={onOpenSearch}>
            <SearchIcon />
            <span>Search {docs.length} {docs.length === 1 ? "document" : "documents"}</span>
            <kbd>⌘ K</kbd>
          </button>
        </div>
      </header>

      {starred.length > 0 && (
        <section className="workspaceSection">
          <WorkspaceSectionHeading title="Starred" action="View all" onAction={() => onOpenView({ type: "starred" })} />
          <WorkspaceDocumentRows assignments={assignments} docs={starred} deletedCollections={deletedCollections} onOpenDocument={onOpenDocument} />
        </section>
      )}

      <section className="workspaceSection">
        <WorkspaceSectionHeading title="Collections" action="View all" onAction={() => onOpenView({ type: "collections" })} />
        <CollectionGrid assignments={assignments} collections={collections} docs={docs} deletedCollections={deletedCollections} onOpenCollection={onOpenCollection} />
      </section>

      <section className="workspaceSection">
        <WorkspaceSectionHeading title="Recent" action="View all" onAction={() => onOpenView({ type: "recent" })} />
        <WorkspaceDocumentRows
          assignments={assignments}
          docs={recent}
          deletedCollections={deletedCollections}
          onOpenDocument={onOpenDocument}
        />
      </section>
    </div>
  );
}

function WorkspaceCollections({
  assignments,
  collections,
  docs,
  deletedCollections,
  initialCreating,
  onCreateCollection,
  onOpenCollection
}: {
  assignments: Record<string, string>;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  initialCreating: boolean;
  onCreateCollection: (title: string, description: string) => Promise<boolean>;
  onOpenCollection: (slug: string) => void;
}) {
  const [creating, setCreating] = useState(initialCreating);

  return (
    <div className="workspaceHub" aria-label="Collections">
      <header className="workspacePageHeader">
        <div className="workspacePageHeaderLine">
          <h1>Collections</h1>
          <button data-collection-dialog-focus-fallback type="button" onClick={() => setCreating(true)}>New collection</button>
        </div>
        <p>Related documents, kept together.</p>
      </header>
      <CollectionGrid assignments={assignments} collections={collections} docs={docs} deletedCollections={deletedCollections} onOpenCollection={onOpenCollection} />
      {creating && <CollectionDialog onClose={() => setCreating(false)} onSave={onCreateCollection} />}
    </div>
  );
}

function CollectionGrid({
  assignments,
  collections,
  docs,
  deletedCollections,
  onOpenCollection
}: {
  assignments: Record<string, string>;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  onOpenCollection: (slug: string) => void;
}) {
  return (
    <div className="workspaceCollectionGrid">
      {collections.map((collection) => {
        const count = docsInCollection(docs, collection.slug, assignments, deletedCollections).length;
        return (
          <button type="button" className="workspaceCollectionCard" key={collection.slug} onClick={() => onOpenCollection(collection.slug)}>
            <span className="workspaceCollectionBody">
              <span className="workspaceCollectionTitle"><strong>{collection.title}</strong><small>{count} {count === 1 ? "file" : "files"}</small></span>
              <span className="workspaceCollectionDescription">{collection.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WorkspaceCollectionView({
  assignments,
  assignmentDisabled,
  collection,
  collections,
  docs,
  deletedCollections,
  onAssignCollection,
  onDeleteCollection,
  onOpenDocument,
  onOpenSearch,
  onToggleStar,
  onUpdateCollection,
  pendingCollectionSlugs,
  pendingDocIds,
  collectionCountComplete
}: {
  assignments: Record<string, string>;
  assignmentDisabled: boolean;
  collection: WorkspaceCollection;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  onAssignCollection: (id: string, slug: string) => Promise<boolean>;
  onDeleteCollection: (slug: string) => Promise<boolean>;
  onOpenDocument: (doc: Doc) => void;
  onOpenSearch: () => void;
  onToggleStar: (id: string) => Promise<boolean>;
  onUpdateCollection: (slug: string, title: string, description: string) => Promise<boolean>;
  pendingCollectionSlugs: Set<string>;
  pendingDocIds: Set<string>;
  collectionCountComplete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="workspaceHub" aria-label={collection.title}>
      <header className="workspaceCollectionHeader">
        <h1>{collection.title}</h1>
        <p>{collection.description}</p>
      </header>

      <section className="workspaceSection workspaceCollectionSection">
        <div className="workspaceCollectionToolbar">
          <div className="workspaceCollectionToolbarTitle">
            <span>{docs.length} {docs.length === 1 ? "file" : "files"}</span>
          </div>
          <div className="workspaceCollectionUtilityActions">
            <button type="button" onClick={onOpenSearch}><SearchIcon />Search</button>
            {collection.slug !== "documents" && <button type="button" disabled={pendingCollectionSlugs.has(collection.slug)} onClick={() => setEditing(true)}>Edit</button>}
            {collection.slug !== "documents" && (
              <button
                type="button"
                className="workspaceCollectionDelete"
                disabled={pendingCollectionSlugs.has(collection.slug)}
                onClick={() => setDeleting(true)}
              >
                {pendingCollectionSlugs.has(collection.slug) ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        </div>
        <WorkspaceDocumentRows
          assignments={assignments}
          assignmentDisabled={assignmentDisabled}
          docs={docs}
          deletedCollections={deletedCollections}
          empty="No documents here yet. Use + in the top bar to add the first one."
          showActions
          showCollectionLabel={false}
          onAssignCollection={onAssignCollection}
          onOpenDocument={onOpenDocument}
          onToggleStar={onToggleStar}
          collections={collections}
          pendingDocIds={pendingDocIds}
        />
      </section>
      {editing && (
        <CollectionDialog
          collection={collection}
          onClose={() => setEditing(false)}
          onSave={(title, description) => onUpdateCollection(collection.slug, title, description)}
        />
      )}
      {deleting && (
        <DeleteCollectionDialog
          collection={collection}
          documentCount={docs.length}
          documentCountComplete={collectionCountComplete}
          onClose={() => setDeleting(false)}
          onDelete={() => onDeleteCollection(collection.slug)}
        />
      )}
    </div>
  );
}

function WorkspaceList({
  assignments,
  assignmentDisabled,
  collections,
  docs,
  deletedCollections,
  title,
  description,
  empty,
  onAssignCollection,
  onOpenDocument,
  onToggleStar,
  pendingDocIds
}: {
  assignments: Record<string, string>;
  assignmentDisabled: boolean;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  title: string;
  description: string;
  empty: string;
  onAssignCollection: (id: string, slug: string) => Promise<boolean>;
  onOpenDocument: (doc: Doc) => void;
  onToggleStar: (id: string) => Promise<boolean>;
  pendingDocIds: Set<string>;
}) {
  return (
    <div className="workspaceHub" aria-label={title}>
      <header className="workspacePageHeader">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <WorkspaceDocumentRows
        assignments={assignments}
        assignmentDisabled={assignmentDisabled}
        docs={docs}
        deletedCollections={deletedCollections}
        empty={empty}
        showActions
        onAssignCollection={onAssignCollection}
        onOpenDocument={onOpenDocument}
        onToggleStar={onToggleStar}
        collections={collections}
        pendingDocIds={pendingDocIds}
      />
    </div>
  );
}

function WorkspaceSectionHeading({
  title,
  action,
  detail,
  onAction
}: {
  title: string;
  action?: string;
  detail?: string;
  onAction?: () => void;
}) {
  return (
    <div className="workspaceSectionHeading">
      <h2>{title}</h2>
      {action && onAction ? <button type="button" onClick={onAction}>{action}</button> : <span>{detail}</span>}
    </div>
  );
}

function WorkspaceDocumentRows({
  assignments,
  assignmentDisabled = false,
  collections = WORKSPACE_COLLECTIONS,
  docs,
  deletedCollections = [],
  empty = "No documents yet.",
  showActions = false,
  showCollectionLabel = true,
  onAssignCollection,
  onOpenDocument,
  onToggleStar,
  pendingDocIds = new Set()
}: {
  assignments: Record<string, string>;
  assignmentDisabled?: boolean;
  collections?: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections?: string[];
  empty?: string;
  showActions?: boolean;
  showCollectionLabel?: boolean;
  onAssignCollection?: (id: string, slug: string) => Promise<boolean>;
  onOpenDocument: (doc: Doc) => void;
  onToggleStar?: (id: string) => Promise<boolean>;
  pendingDocIds?: Set<string>;
}) {
  return (
    <div className="workspaceDocumentList">
      {docs.map((doc) => (
        <div className="workspaceDocumentRow" key={doc.id}>
          <button type="button" className="workspaceDocumentOpen" onClick={() => onOpenDocument(doc)}>
            <span className="workspaceDocumentText">
              <strong>{editorDocTitle(doc)}</strong>
              <span className="workspaceDocumentMeta">
                {showCollectionLabel && <small>{collectionLabel(collectionForDoc(doc, assignments, deletedCollections), collections)}</small>}
                <span className="workspaceDocumentSummary">{workspaceDocSummary(doc)}</span>
              </span>
            </span>
          </button>
          {showActions && (
            <div className="workspaceDocumentActions">
              {onAssignCollection && (
                <select
                  className="workspaceCollectionSelect"
                  aria-label={`Collection for ${editorDocTitle(doc)}`}
                  value={collectionForDoc(doc, assignments, deletedCollections)}
                  disabled={assignmentDisabled || pendingDocIds.has(doc.id)}
                  onChange={(event) => void onAssignCollection(doc.id, event.target.value)}
                >
                  {collections.map((collection) => <option value={collection.slug} key={collection.slug}>{collection.title}</option>)}
                </select>
              )}
              {onToggleStar && (
                <button
                  type="button"
                  className="workspaceStarButton"
                  data-pinned={Boolean(doc.pinned)}
                  aria-label={`${doc.pinned ? "Unstar" : "Star"} ${editorDocTitle(doc)}`}
                  disabled={pendingDocIds.has(doc.id)}
                  onClick={() => void onToggleStar(doc.id)}
                >
                  <StarIcon filled={Boolean(doc.pinned)} />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {docs.length === 0 && <p className="workspaceEmptyList">{empty}</p>}
    </div>
  );
}

const MODAL_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE))
    .filter((element) => !element.hidden);
}

function CollectionModal({
  ariaLabel,
  children,
  dismissDisabled = false,
  initialFocus,
  onClose
}: {
  ariaLabel: string;
  children: React.ReactNode;
  dismissDisabled?: boolean;
  initialFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const backdropPressStarted = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalRoot = backdrop.current;
    const body = document.body;
    const background = Array.from(body.children).filter((element) => element !== modalRoot);
    const previousInert = background.map((element) => [element, element.hasAttribute("inert")] as const);
    const previousOverflow = body.style.overflow;

    background.forEach((element) => element.setAttribute("inert", ""));
    body.style.overflow = "hidden";
    initialFocus.current?.focus();

    function keepFocusInside(event: FocusEvent) {
      if (dialog.current?.contains(event.target as Node)) return;
      if (!dialog.current) return;
      const focusable = focusableElements(dialog.current);
      const preferred = initialFocus.current && focusable.includes(initialFocus.current)
        ? initialFocus.current
        : focusable[0] ?? dialog.current;
      preferred.focus();
    }

    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      body.style.overflow = previousOverflow;
      previousInert.forEach(([element, wasInert]) => {
        if (!wasInert) element.removeAttribute("inert");
      });
      const element = trigger.current;
      window.requestAnimationFrame(() => {
        if (element?.isConnected) {
          element.focus();
        } else {
          document.querySelector<HTMLElement>("[data-collection-dialog-focus-fallback]")?.focus();
        }
      });
    };
  }, [initialFocus]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!dismissDisabled) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = focusableElements(dialog.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      ref={backdrop}
      className="workspace workspaceCollectionDialogBackdrop"
      role="presentation"
      onPointerDown={(event) => {
        backdropPressStarted.current = event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        backdropPressStarted.current = false;
      }}
      onClick={(event) => {
        const shouldDismiss = backdropPressStarted.current && event.target === event.currentTarget;
        backdropPressStarted.current = false;
        if (!dismissDisabled && shouldDismiss) onClose();
      }}
    >
      <section
        ref={dialog}
        className="workspaceCollectionDialog"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>,
    document.body
  );
}

function CollectionDialog({
  collection,
  onClose,
  onSave
}: {
  collection?: WorkspaceCollection;
  onClose: () => void;
  onSave: (title: string, description: string) => Promise<boolean>;
}) {
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(collection?.title ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      titleInput.current?.focus();
      return;
    }
    setErrorMessage("");
    setSaving(true);
    const saved = await onSave(nextTitle, description.trim());
    if (saved) {
      onClose();
      return;
    }
    setSaving(false);
    setErrorMessage("Collection could not be saved. Try again.");
    window.requestAnimationFrame(() => titleInput.current?.focus());
  }

  return (
    <CollectionModal
      ariaLabel={collection ? "Edit collection" : "New collection"}
      dismissDisabled={saving}
      initialFocus={titleInput}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <header>
          <h2>{collection ? "Edit collection" : "New collection"}</h2>
          <p>Group related Markdown for you and your agents.</p>
        </header>
        <label>
          <span>Title</span>
          <input ref={titleInput} aria-label="Collection title" autoComplete="off" name="collection-title" maxLength={80} value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Description <small>Optional</small></span>
          <textarea aria-label="Collection description" maxLength={180} rows={3} value={description} disabled={saving} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {errorMessage && <p className="workspaceCollectionDialogError" role="alert">{errorMessage}</p>}
        <footer>
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving || !title.trim()}>{saving ? "Saving…" : collection ? "Save" : "Create collection"}</button>
        </footer>
      </form>
    </CollectionModal>
  );
}

function DeleteCollectionDialog({
  collection,
  documentCount,
  documentCountComplete,
  onClose,
  onDelete
}: {
  collection: WorkspaceCollection;
  documentCount: number;
  documentCountComplete: boolean;
  onClose: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const noun = documentCount === 1 ? "document" : "documents";
  const moveSummary = documentCountComplete
    ? `${documentCount} ${noun} will move to Documents.`
    : "Its documents will move to Documents.";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setDeleting(true);
    if (await onDelete()) {
      onClose();
      return;
    }
    setDeleting(false);
    setErrorMessage("Collection could not be deleted. Try again.");
    window.requestAnimationFrame(() => cancelButton.current?.focus());
  }

  return (
    <CollectionModal ariaLabel="Delete collection" dismissDisabled={deleting} initialFocus={cancelButton} onClose={onClose}>
      <form onSubmit={submit}>
        <header>
          <h2>Delete collection</h2>
          <p>Delete “{collection.title}”? {moveSummary}</p>
        </header>
        {errorMessage && <p className="workspaceCollectionDialogError" role="alert">{errorMessage}</p>}
        <footer>
          <button ref={cancelButton} type="button" disabled={deleting} onClick={onClose}>Cancel</button>
          <button className="workspaceCollectionDialogDanger" type="submit" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete collection"}
          </button>
        </footer>
      </form>
    </CollectionModal>
  );
}

type WorkspaceSearchProps = {
  assignments: Record<string, string>;
  collections: WorkspaceCollection[];
  docs: Doc[];
  deletedCollections: string[];
  query: string;
  scope: string;
  trigger: HTMLElement | null;
  userId?: string;
  searchPaused?: boolean;
  searchPauseError?: boolean;
  onClose: () => void;
  onOpenDocument: (doc: Doc) => void;
  onQueryChange: (query: string) => void;
  onRetryPendingSave?: () => void;
  onScopeChange: (scope: string) => void;
};

export function WorkspaceSearch({
  assignments,
  collections,
  docs,
  deletedCollections,
  query,
  scope,
  trigger,
  userId,
  searchPaused = false,
  searchPauseError = false,
  onClose,
  onOpenDocument,
  onQueryChange,
  onRetryPendingSave,
  onScopeChange
}: WorkspaceSearchProps) {
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(true);
  const fullTextPaused = searchPaused && Boolean(query.trim());
  const scopedCollection = scope === "all" || scope === "documents"
    ? undefined
    : collections.find((collection) => collection.slug === scope);
  const search = useEditorSearch({
    query,
    scope: scope === "documents"
      ? { unfiled: true }
      : scopedCollection?.id
        ? { collectionId: scopedCollection.id }
        : {},
    userId: scopedCollection || scope === "all" || scope === "documents" ? userId : undefined,
    paused: fullTextPaused
  });
  const localResults = searchWorkspaceDocs(docs, query, scope, assignments, deletedCollections).slice(0, 20);
  const recentResults = searchWorkspaceDocs(docs, "", scope, assignments, deletedCollections).slice(0, 20);
  const results: Array<Doc | SearchDocument> = search.active
    ? search.documents
    : query
      ? localResults
      : recentResults;

  useEffect(() => {
    input.current?.focus();
    return () => {
      if (restoreFocus.current) window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [trigger]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="workspaceSearchBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialog} className="workspaceSearchDialog" role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={handleKeyDown}>
        <div className="workspaceSearchInput">
          <SearchIcon />
          <input ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)} aria-label="Search documents and tags" placeholder="Search your Markdown…" />
          <kbd>ESC</kbd>
        </div>
        <div className="workspaceSearchScopes">
          <button type="button" data-active={scope === "all"} onClick={() => onScopeChange("all")}>All</button>
          {collections.map((collection) => (
            <button type="button" data-active={scope === collection.slug} key={collection.slug} onClick={() => onScopeChange(collection.slug)}>{collection.title}</button>
          ))}
        </div>
        <div className="workspaceSearchResults">
          <p role="status">{fullTextPaused ? searchPauseError ? "Search paused" : "Saving before search…" : search.loading ? "Searching…" : query ? `${results.length} results` : "Recently updated"}</p>
          {results.map((doc) => (
            <button type="button" key={doc.id} onClick={() => { restoreFocus.current = false; onOpenDocument(doc); }}>
              <span className="workspaceDocumentIcon"><DocIcon /></span>
              <span><strong>{editorDocTitle(doc)}</strong><small>{collectionLabel(collectionForDoc(doc, assignments, deletedCollections), collections)}</small><em>{"matchExcerpt" in doc ? doc.matchExcerpt : workspaceDocSummary(doc)}</em></span>
              {doc.pinned && <StarIcon filled />}
            </button>
          ))}
          {fullTextPaused && searchPauseError ? (
            <div className="workspaceSearchEmpty" role="alert">
              <strong>Save the current document to search</strong>
              <span>The latest draft could not be saved.</span>
              <button type="button" onClick={onRetryPendingSave}>Try again</button>
            </div>
          ) : search.errorMessage ? (
            <div className="workspaceSearchEmpty" role="alert">
              <strong>Search could not be completed</strong>
              <span>{search.errorMessage}</span>
              <button type="button" onClick={search.retry}>Try again</button>
            </div>
          ) : !fullTextPaused && !search.loading && results.length === 0 ? (
            <div className="workspaceSearchEmpty"><strong>No matching documents</strong><span>Try another term or collection.</span></div>
          ) : null}
          {search.hasMore && (
            <button type="button" className="workspaceSearchMore" disabled={search.loading} onClick={search.loadMore}>
              {search.loading ? "Loading…" : "Load more results"}
            </button>
          )}
        </div>
        <footer className="workspaceSearchFooter"><span>Esc to close</span><span>Searches titles, text, and tags</span></footer>
      </section>
    </div>
  );
}
