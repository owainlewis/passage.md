"use client";

import Link from "next/link";
import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PendingStatus, useAuth } from "./auth";
import { bodyWithoutFrontmatter, titleOf, wordCount } from "./doc-utils";
import { formatDocumentCount, isNearDocumentLimit } from "./document-limits";
import { EditorSidebar } from "./editor-sidebar";
import { isShared, Mode, publicIdFromPath } from "./editor-model";
import { EditorStatusBar } from "./editor-status-bar";
import { EditorWorkspace, WorkspaceModal, WorkspaceSearch } from "./editor-workspace";
import { currentWorkspaceLocation, workspacePath } from "./editor-workspace-location";
import { collectionForDoc, collectionLabel, WORKSPACE_COLLECTIONS, WorkspaceView } from "./editor-workspace-model";
import { useEntitlements } from "./entitlements";
import { PlusIcon, SidebarIcon, StarIcon, UserIcon } from "./icons";
import { MarkdownView } from "./markdown-view";
import { TemplateWorkspace } from "./template-workspace";
import { useEditorDocuments } from "./use-editor-documents";
import { useEditorCollections } from "./use-editor-collections";
import { useEditorSharing } from "./use-editor-sharing";
import { useEditorTemplates } from "./use-editor-templates";
import { useEditorTheme } from "./use-editor-theme";

const EMPTY_ASSIGNMENTS: Record<string, string> = {};
const NO_DELETED_COLLECTIONS: string[] = [];

export default function Editor() {
  const [mode, setMode] = useState<Mode>("preview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogDocId, setDeleteDialogDocId] = useState("");
  const [shareDialogDocId, setShareDialogDocId] = useState("");
  const [authError, setAuthError] = useState("");
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => currentWorkspaceLocation().view);
  const [newDocumentCollection, setNewDocumentCollection] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("all");
  const [searchTrigger, setSearchTrigger] = useState<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const writingPaneRef = useRef<HTMLElement>(null);
  const workspaceViewRef = useRef(workspaceView);
  workspaceViewRef.current = workspaceView;

  const auth = useAuth();
  const userId = auth.user?.id;
  const entitlements = useEntitlements();
  const { darkActive, theme, toggleDarkMode } = useEditorTheme();
  const templateState = useEditorTemplates(userId);
  const {
    active,
    activeLoadError,
    activeLoading,
    activeId,
    billingNotice,
    billingNoticeAction,
    createDoc: createDocument,
    deleteDoc: archiveDocument,
    docs,
    documentIndexComplete,
    documentIndexError,
    hasMoreDocs,
    loadMoreDocs,
    loadingMore,
    pendingSave,
    retryActive,
    saveState,
    selectDoc,
    setBillingNotice,
    setDocs,
    setPendingSave,
    setSaveState,
    setDocumentFilter,
    updateBody
  } = useEditorDocuments({
    userId,
    maxSavedDocs: entitlements.maxSavedDocs,
    plan: entitlements.plan,
    focusEditor: () => textareaRef.current?.focus()
  });

  const collectionNotice = useRef("");
  const setCollectionNotice = useCallback<Dispatch<SetStateAction<string>>>((notice) => {
    const message = typeof notice === "function" ? notice(collectionNotice.current) : notice;
    collectionNotice.current = message;
    setBillingNotice(message);
  }, [setBillingNotice]);

  const collectionState = useEditorCollections({
    userId,
    docs,
    setDocs,
    setNotice: setCollectionNotice
  });

  const activeShared = active ? isShared(active) : false;
  const shareDialogOpen = Boolean(active && shareDialogDocId === active.id);
  const {
    exportDoc,
    publicDocPath,
    shareButtonLabel,
    shareDoc,
    shareState,
    unshareDoc
  } = useEditorSharing({
    active,
    activeShared,
    pendingSave,
    canExport: entitlements.can("exportMarkdown"),
    canShare: entitlements.can("shareLinks"),
    setBillingNotice,
    setDocs,
    setPendingSave,
    setSaveState,
    setDocumentFilter
  });

  useEffect(() => {
    if (window.matchMedia?.("(max-width: 720px)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element || mode !== "edit") return;
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [active?.body, mode, activeId]);

  const toggleMode = useCallback(() => {
    setMode((current) => (current === "edit" ? "preview" : "edit"));
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (!searchOpen) {
          setSearchTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
        }
        setSearchScope("all");
        setSearchQuery("");
        setSearchOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        toggleMode();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, toggleMode]);

  useEffect(() => {
    function onPopState() {
      setDeleteDialogDocId("");
      setShareDialogDocId("");
      const location = currentWorkspaceLocation();
      setActiveTemplateId("");
      if (location.shouldReplace) {
        window.history.replaceState(null, "", location.canonicalPath);
      }
      if (location.view.type !== "document") {
        setWorkspaceView(location.view);
        return;
      }
      setWorkspaceView({ type: "document" });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function createDoc(body = "") {
    const created = await createDocument(body);
    if (!created) return false;
    if (newDocumentCollection) {
      await collectionState.assignCollection(created.id, newDocumentCollection);
    }
    setNewDocumentCollection(null);
    setActiveTemplateId("");
    setMode("edit");
    setWorkspaceView({ type: "document" });
    return true;
  }

  async function deleteDoc(id: string) {
    const document = docs.find((candidate) => candidate.id === id);
    if (!document) return;
    const startingLocation = `${window.location.pathname}${window.location.search}`;
    const replacement = await archiveDocument(id);
    if (replacement === false) return;
    const currentLocation = `${window.location.pathname}${window.location.search}`;
    if (workspaceViewRef.current.type !== "document" || currentLocation !== startingLocation) return;
    if (replacement) {
      setWorkspaceView({ type: "document" });
      selectDoc(replacement, "replace");
      return;
    }
    openWorkspaceView({ type: "home" }, "replace");
  }

  function openTemplates() {
    if (workspaceView.type !== "templates") {
      setNewDocumentCollection(workspaceView.type === "collection" ? workspaceView.slug : null);
    }
    openWorkspaceView({ type: "templates" });
  }

  function selectDocument(doc: Parameters<typeof selectDoc>[0]) {
    setActiveTemplateId("");
    setWorkspaceView({ type: "document" });
    selectDoc(doc, "push");
    if (window.matchMedia?.("(max-width: 720px)").matches) setSidebarOpen(false);
  }

  function selectSearchDocument(doc: Parameters<typeof selectDoc>[0]) {
    const existing = docs.find((candidate) => candidate.id === doc.id);
    const selected = existing
      ? { ...doc, body: existing.body, bodyLoaded: existing.bodyLoaded }
      : doc;
    setDocs((current) => {
      const known = current.some((candidate) => candidate.id === selected.id);
      return known
        ? current.map((candidate) => candidate.id === selected.id ? { ...candidate, ...selected } : candidate)
        : [selected, ...current];
    });
    setSearchOpen(false);
    selectDocument(selected);
    requestAnimationFrame(() => writingPaneRef.current?.focus());
  }

  function openWorkspaceView(view: WorkspaceView, history: "push" | "replace" = "push") {
    if (view.type === "document") return;
    setActiveTemplateId("");
    setWorkspaceView(view);
    const nextPath = workspacePath(view);
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history[history === "push" ? "pushState" : "replaceState"](null, "", nextPath);
    }
    if (window.matchMedia?.("(max-width: 720px)").matches) setSidebarOpen(false);
  }

  function openCollection(slug: string) {
    openWorkspaceView({ type: "collection", slug });
  }

  function openSearch(scope = "all") {
    if (!searchOpen) {
      setSearchTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    setSearchScope(scope);
    setSearchQuery("");
    setSearchOpen(true);
  }

  async function createCollection(title: string, description: string) {
    const collection = await collectionState.createCollection(title, description);
    if (!collection) {
      const error = collectionNotice.current || "Collection could not be created";
      setCollectionNotice("");
      return error;
    }
    openCollection(collection.slug);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-collection-dialog-focus-destination]")?.focus();
    });
    return null;
  }

  async function updateCollection(slug: string, title: string, description: string) {
    const saved = await collectionState.updateCollection(slug, title, description);
    if (saved) return null;
    const error = collectionNotice.current || "Collection could not be saved";
    setCollectionNotice("");
    return error;
  }

  async function deleteCollection(slug: string) {
    if (slug === "documents") return false;
    const collection = collections.find((candidate) => candidate.slug === slug);
    if (!collection) return false;
    if (!await collectionState.deleteCollection(slug)) {
      setBillingNotice("");
      return false;
    }
    setSearchScope("all");
    setBillingNotice(`“${collection.title}” was deleted. Its documents are now in Documents.`);
    openWorkspaceView({ type: "collections" }, "replace");
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-collection-dialog-focus-fallback]")?.focus();
    });
    return true;
  }

  async function signOut() {
    setAuthError("");
    try {
      await auth.signOut();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign out failed");
    }
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  const words = active ? wordCount(active.body) : 0;
  const title = active ? titleOf(active.body) : "";
  const docsReady = saveState !== "loading" && !collectionState.loading;
  const showSaveState = saveState !== "saved";
  const savedDocs = auth.account?.usage.savedDocs ?? 0;
  const nearDocumentLimit =
    entitlements.plan === "pro" && isNearDocumentLimit(savedDocs, entitlements.maxSavedDocs);
  const nearDocumentLimitNotice = `You're using ${formatDocumentCount(savedDocs)} of ${formatDocumentCount(entitlements.maxSavedDocs)} saved documents.`;
  const collections = useMemo(
    () => [...collectionState.collections, ...WORKSPACE_COLLECTIONS],
    [collectionState.collections]
  );

  useEffect(() => {
    const location = currentWorkspaceLocation();
    if (location.shouldReplace) {
      window.history.replaceState(null, "", location.canonicalPath);
    }
  }, []);

  useEffect(() => {
    if (workspaceView.type !== "document") return;
    const publicId = publicIdFromPath();
    if (!publicId && !/^\/write\/[^/]+$/.test(window.location.pathname)) return;
    const requestedDocument = docs.find((doc) => doc.publicId === publicId);
    if (requestedDocument) {
      if (requestedDocument.id !== activeId) selectDoc(requestedDocument, "none");
      return;
    }
    if (!documentIndexComplete) return;
    setBillingNotice("Document could not be found");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaceView({ type: "home" });
    window.history.replaceState(null, "", "/write");
  }, [activeId, docs, documentIndexComplete, selectDoc, setBillingNotice, workspaceView.type]);

  useEffect(() => {
    if (!collectionState.available || workspaceView.type !== "collection") return;
    if (collections.some((collection) => collection.slug === workspaceView.slug)) return;
    setBillingNotice("Collection could not be found");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaceView({ type: "collections" });
    window.history.replaceState(null, "", workspacePath({ type: "collections" }));
  }, [collectionState.available, collections, setBillingNotice, workspaceView]);

  const activeCollection = active ? collectionForDoc(active, EMPTY_ASSIGNMENTS) : "documents";
  const templatesOpen = workspaceView.type === "templates";
  const hasDocumentRoute = workspaceView.type === "document"
    && typeof window !== "undefined"
    && /^\/write\/[^/]+$/.test(window.location.pathname);
  const requestedDocumentPublicId = workspaceView.type === "document" ? publicIdFromPath() : "";
  const documentRouteResolved = workspaceView.type !== "document"
    || !hasDocumentRoute
    || active?.publicId === requestedDocumentPublicId;
  const workspaceTitle = templatesOpen
    ? "Templates"
    : workspaceView.type === "document"
      ? title
      : workspaceView.type === "collection"
        ? collectionLabel(workspaceView.slug, collections)
        : workspaceView.type === "home"
          ? "Home"
          : workspaceView.type.charAt(0).toUpperCase() + workspaceView.type.slice(1);
  const showDocument = !templatesOpen && workspaceView.type === "document";
  const showResolvedDocument = showDocument && documentRouteResolved;
  const showTopBarTitle = docsReady && (templatesOpen || (showResolvedDocument && mode === "edit"));
  const canDeleteActive = Boolean(active && !isShared(active));

  return (
    <div className={`workspace ${sidebarOpen ? "withSidebar" : ""}`}>
      <EditorSidebar
        assignments={EMPTY_ASSIGNMENTS}
        collections={collections}
        deletedCollections={NO_DELETED_COLLECTIONS}
        docs={docs}
        onOpenCollection={openCollection}
        onOpenSearch={() => openSearch()}
        onOpenTemplates={openTemplates}
        onOpenView={(view) => openWorkspaceView(view)}
        onToggleDarkMode={toggleDarkMode}
        sidebarOpen={sidebarOpen}
        templateCount={templateState.templates.length}
        templatesActive={templatesOpen}
        theme={theme}
        view={workspaceView}
      />

      <div className="main" inert={searchOpen ? true : undefined}>
        <header className="topBar">
          <div className="topCluster">
            <button
              type="button"
              className="iconButton"
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <SidebarIcon />
            </button>
            <button
              type="button"
              className="iconButton"
              aria-label="New document"
              disabled={!docsReady}
              onClick={openTemplates}
            >
              <PlusIcon />
            </button>
          </div>

          {showTopBarTitle
            ? <h1 className="docTitle" title={workspaceTitle}>{workspaceTitle}</h1>
            : <span className="docTitle" aria-hidden="true" />}

          <div className="topCluster end">
            {showResolvedDocument && active && (
              <>
                <select
                  className="topBarCollectionSelect"
                  aria-label={`Collection for ${title}`}
                  value={activeCollection}
                  disabled={!collectionState.available || collectionState.pendingDocIds.has(active.id)}
                  onChange={(event) => void collectionState.assignCollection(active.id, event.target.value)}
                >
                  {collections.map((collection) => <option key={collection.slug} value={collection.slug}>{collection.title}</option>)}
                </select>
                <button
                  type="button"
                  className="iconButton"
                  aria-label={active.pinned ? "Unstar document" : "Star document"}
                  disabled={collectionState.pendingDocIds.has(active.id)}
                  onClick={() => void collectionState.toggleStar(active.id)}
                >
                  <StarIcon filled={Boolean(active.pinned)} />
                </button>
                {canDeleteActive && (
                  <button
                    type="button"
                    className="topBarDelete"
                    disabled={collectionState.pendingDocIds.has(active.id)}
                    onClick={() => setDeleteDialogDocId(active.id)}
                  >
                    Delete
                  </button>
                )}
              </>
            )}
            <div className="userMenuWrap">
              <button
                type="button"
                className="iconButton userButton"
                aria-label="Account"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              >
                <UserIcon />
              </button>
              {menuOpen && (
                <>
                  <div className="menuOverlay" onClick={closeMenu} aria-hidden="true" />
                  <div className="userMenu" role="menu">
                    <div className="menuAccount">
                      <span className="menuAccountLabel">Signed in</span>
                      <span className="menuAccountEmail">{auth.user?.email}</span>
                    </div>
                    {authError && <p className="authError">{authError}</p>}
                    <Link className="menuItem" role="menuitem" href="/account" onClick={closeMenu}>
                      Account settings
                    </Link>
                    <button type="button" className="menuItem" role="menuitem" onClick={() => void signOut()}>
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {billingNotice ? (
          <div className="billingNotice">
            <span>{billingNotice}</span>
            {billingNoticeAction === "limit" ? (
              <Link href="/account#document-limit">Request more</Link>
            ) : billingNoticeAction === "upgrade" ? (
              <Link href="/account">Upgrade</Link>
            ) : null}
          </div>
        ) : nearDocumentLimit ? (
          <div className="billingNotice">
            <span>{nearDocumentLimitNotice}</span>
            <Link href="/account#document-limit">Request more</Link>
          </div>
        ) : null}

        {templatesOpen ? (
          <TemplateWorkspace
            activeTemplateId={activeTemplateId}
            darkActive={darkActive}
            error={templateState.error}
            loading={templateState.loading}
            saving={templateState.saving}
            templates={templateState.templates}
            onCreateDocument={createDoc}
            onCreateTemplate={templateState.createTemplate}
            onDeleteTemplate={templateState.deleteTemplate}
            onEditTemplate={setActiveTemplateId}
            onShowLibrary={() => setActiveTemplateId("")}
            onUpdateTemplate={templateState.updateTemplate}
          />
        ) : showDocument ? <section ref={writingPaneRef} tabIndex={-1} className={`writingPane ${active && documentRouteResolved ? "" : "writingPaneEmpty"}`} aria-label="Markdown editor">
          {!documentRouteResolved ? (
            documentIndexError ? (
              <div className="emptyDocuments" role="alert">
                <h2>Document could not be checked.</h2>
                <p>Your document URL has been kept. Reload to try again.</p>
              </div>
            ) : <PendingStatus label="Loading document" />
          ) : saveState === "loading" || activeLoading ? (
            <PendingStatus label="Loading saved docs" />
          ) : activeLoadError ? (
            <div className="emptyDocuments" role="alert">
              <h2>Document could not be loaded.</h2>
              <p>Your saved Markdown has not been changed.</p>
              <button type="button" className="emptyDocumentsCreate" onClick={retryActive}>
                Try again
              </button>
            </div>
          ) : !active ? (
            <div className="emptyDocuments">
              <h2>No documents yet.</h2>
              <p>Create a document to start writing.</p>
              <button type="button" className="emptyDocumentsCreate" onClick={openTemplates}>
                <PlusIcon />
                <span>Create document</span>
              </button>
            </div>
          ) : mode === "edit" ? (
            <textarea
              ref={textareaRef}
              className="editor"
              aria-label="Markdown editor"
              aria-multiline="true"
              spellCheck
              placeholder="Start writing Markdown."
              value={active.body}
              onChange={(event) => updateBody(event.target.value)}
            />
          ) : (
            <MarkdownView source={bodyWithoutFrontmatter(active.body)} theme={darkActive ? "dark" : "light"} />
          )}
        </section> : (
          <EditorWorkspace
            assignments={EMPTY_ASSIGNMENTS}
            assignmentDisabled={!collectionState.available}
            collectionAvailable={collectionState.available}
            collections={collections}
            deletedCollections={NO_DELETED_COLLECTIONS}
            docs={docs}
            saveState={collectionState.loading ? "loading" : saveState}
            view={workspaceView}
            onAssignCollection={collectionState.assignCollection}
            onCreateCollection={createCollection}
            onDeleteCollection={deleteCollection}
            onOpenCollection={openCollection}
            onOpenDocument={selectDocument}
            onOpenSearch={openSearch}
            onOpenView={(view) => openWorkspaceView(view)}
            hasMoreDocs={hasMoreDocs}
            loadingMore={loadingMore}
            onLoadMoreDocs={() => void loadMoreDocs()}
            onToggleStar={collectionState.toggleStar}
            onUpdateCollection={updateCollection}
            pendingCollectionSlugs={collectionState.pendingCollectionSlugs}
            pendingDocIds={collectionState.pendingDocIds}
          />
        )}

        {showResolvedDocument && docsReady && active?.bodyLoaded && (
          <EditorStatusBar
            activeShared={activeShared}
            mode={mode}
            onExport={exportDoc}
            onModeChange={setMode}
            onOpenShare={() => {
              if (!activeShared && !entitlements.can("shareLinks")) {
                void shareDoc();
                return;
              }
              setShareDialogDocId(active?.id ?? "");
            }}
            saveState={saveState}
            shareDialogOpen={shareDialogOpen}
            shareButtonLabel={shareButtonLabel}
            shareState={shareState}
            showSaveState={showSaveState}
            words={words}
          />
        )}
      </div>
      {searchOpen && (
        <WorkspaceSearch
          assignments={EMPTY_ASSIGNMENTS}
          collections={collections}
          deletedCollections={NO_DELETED_COLLECTIONS}
          docs={docs}
          query={searchQuery}
          scope={searchScope}
          trigger={searchTrigger}
          userId={userId}
          searchPaused={Boolean(userId && pendingSave)}
          searchPauseError={Boolean(userId && pendingSave && saveState === "error")}
          onClose={() => setSearchOpen(false)}
          onOpenDocument={selectSearchDocument}
          onQueryChange={setSearchQuery}
          onRetryPendingSave={() => setPendingSave((current) => current ? { ...current } : current)}
          onScopeChange={setSearchScope}
        />
      )}
      {shareDialogOpen && active && (
        <DocumentShareDialog
          activeShared={activeShared}
          publicDocPath={publicDocPath}
          title={titleOf(active.body)}
          onClose={() => setShareDialogDocId("")}
          onCopy={() => shareDoc()}
          onPublish={() => shareDoc()}
          onUnshare={() => unshareDoc()}
        />
      )}
      {deleteDialogDocId === active?.id && active && !activeShared && (
        <DeleteDocumentDialog
          title={titleOf(active.body)}
          onClose={() => setDeleteDialogDocId("")}
          onDelete={() => deleteDoc(deleteDialogDocId)}
        />
      )}
    </div>
  );
}

function DocumentShareDialog({
  activeShared,
  publicDocPath,
  title,
  onClose,
  onCopy,
  onPublish,
  onUnshare
}: {
  activeShared: boolean;
  publicDocPath: string;
  title: string;
  onClose: () => void;
  onCopy: () => Promise<boolean>;
  onPublish: () => Promise<boolean>;
  onUnshare: () => Promise<boolean>;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <WorkspaceModal ariaLabel="Share document" initialFocus={cancelButton} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
          void (activeShared ? onCopy() : onPublish());
        }}
      >
        <header>
          <h2>{activeShared ? "Sharing is on" : "Share document"}</h2>
          <p>
            {activeShared
              ? `“${title}” is public to anyone with the link.`
              : `Make “${title}” public to anyone with the link.`}
          </p>
        </header>
        {activeShared && publicDocPath && (
          <Link className="workspaceDialogPublicLink" href={publicDocPath} target="_blank" rel="noreferrer">
            View public document
          </Link>
        )}
        <footer>
          <button ref={cancelButton} type="button" onClick={onClose}>Close</button>
          {activeShared && (
            <button
              type="button"
              onClick={() => {
                onClose();
                void onUnshare();
              }}
            >
              Make private
            </button>
          )}
          <button type="submit">{activeShared ? "Copy link" : "Publish and copy link"}</button>
        </footer>
      </form>
    </WorkspaceModal>
  );
}

function DeleteDocumentDialog({
  title,
  onClose,
  onDelete
}: {
  title: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <WorkspaceModal ariaLabel="Delete document" initialFocus={cancelButton} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
          void onDelete();
        }}
      >
        <header>
          <h2>Delete document</h2>
          <p>Delete “{title}”? You will no longer be able to access it from Passage.</p>
        </header>
        <footer>
          <button ref={cancelButton} type="button" onClick={onClose}>Cancel</button>
          <button className="workspaceCollectionDialogDanger" type="submit">Delete document</button>
        </footer>
      </form>
    </WorkspaceModal>
  );
}
