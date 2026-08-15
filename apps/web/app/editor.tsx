"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PendingStatus, useAuth } from "./auth";
import { bodyWithoutFrontmatter, titleOf, wordCount } from "./doc-utils";
import { formatDocumentCount, isNearDocumentLimit } from "./document-limits";
import { EditorSidebar } from "./editor-sidebar";
import { isShared, Mode, publicIdFromPath } from "./editor-model";
import { EditorStatusBar } from "./editor-status-bar";
import { EditorWorkspace, WorkspaceSearch } from "./editor-workspace";
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
  const [authError, setAuthError] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => publicIdFromPath() ? { type: "document" } : { type: "home" });
  const [newDocumentCollection, setNewDocumentCollection] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("all");
  const [searchTrigger, setSearchTrigger] = useState<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const writingPaneRef = useRef<HTMLElement>(null);

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
    deleteDoc,
    docs,
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

  const collectionState = useEditorCollections({
    userId,
    docs,
    setDocs,
    setNotice: setBillingNotice
  });

  const activeShared = active ? isShared(active) : false;
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
      const publicId = publicIdFromPath();
      if (!publicId) {
        setTemplatesOpen(false);
        setWorkspaceView({ type: "home" });
        return;
      }
      const doc = docs.find((candidate) => candidate.publicId === publicId);
      if (doc) {
        setTemplatesOpen(false);
        setWorkspaceView({ type: "document" });
        selectDoc(doc, "none");
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [docs, selectDoc]);

  async function createDoc(body = "") {
    const created = await createDocument(body);
    if (!created) return false;
    if (newDocumentCollection) {
      await collectionState.assignCollection(created.id, newDocumentCollection);
    }
    setNewDocumentCollection(null);
    setTemplatesOpen(false);
    setActiveTemplateId("");
    setMode("edit");
    setWorkspaceView({ type: "document" });
    return true;
  }

  function openTemplates() {
    setNewDocumentCollection(workspaceView.type === "collection" ? workspaceView.slug : null);
    setTemplatesOpen(true);
    setActiveTemplateId("");
    window.history.pushState(null, "", "/write");
  }

  function selectDocument(doc: Parameters<typeof selectDoc>[0]) {
    setTemplatesOpen(false);
    setActiveTemplateId("");
    setWorkspaceView({ type: "document" });
    selectDoc(doc, "push");
    if (window.matchMedia?.("(max-width: 720px)").matches) setSidebarOpen(false);
  }

  function selectSearchDocument(doc: Parameters<typeof selectDoc>[0]) {
    setSearchOpen(false);
    selectDocument(doc);
    requestAnimationFrame(() => writingPaneRef.current?.focus());
  }

  function openWorkspaceView(view: WorkspaceView) {
    setTemplatesOpen(false);
    setActiveTemplateId("");
    setWorkspaceView(view);
    if (view.type !== "document") window.history.pushState(null, "", "/write");
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
    if (!collection) return false;
    openCollection(collection.slug);
    return true;
  }

  function updateCollection(slug: string, title: string, description: string) {
    return collectionState.updateCollection(slug, title, description);
  }

  async function deleteCollection(slug: string) {
    if (slug === "documents") return;
    const collection = collections.find((candidate) => candidate.slug === slug);
    if (!collection) return;
    const collectionDocs = docs.filter((doc) => collectionForDoc(doc, EMPTY_ASSIGNMENTS) === slug);
    const count = collectionDocs.length;
    const noun = count === 1 ? "document" : "documents";
    const moveSummary = hasMoreDocs
      ? "Its documents will move to Documents."
      : `${count} ${noun} will move to Documents.`;
    if (!window.confirm(`Delete “${collection.title}”? ${moveSummary}`)) return;
    if (!await collectionState.deleteCollection(slug)) return;
    setSearchScope("all");
    openWorkspaceView({ type: "home" });
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
  const collections = [...collectionState.collections, ...WORKSPACE_COLLECTIONS];
  const activeCollection = active ? collectionForDoc(active, EMPTY_ASSIGNMENTS) : "documents";
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
  const showTopBarTitle = docsReady && (templatesOpen || (showDocument && mode === "edit"));
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
        onOpenView={openWorkspaceView}
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
            {showDocument && active && (
              <>
                <select
                  className="topBarCollectionSelect"
                  aria-label={`Collection for ${title}`}
                  value={activeCollection}
                  disabled={collectionState.pendingDocIds.has(active.id)}
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
                    onClick={() => void deleteDoc(active.id)}
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
        ) : showDocument ? <section ref={writingPaneRef} tabIndex={-1} className={`writingPane ${active ? "" : "writingPaneEmpty"}`} aria-label="Markdown editor">
          {saveState === "loading" || activeLoading ? (
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
            collections={collections}
            deletedCollections={NO_DELETED_COLLECTIONS}
            docs={docs}
            saveState={collectionState.loading ? "loading" : saveState}
            view={workspaceView}
            onAssignCollection={collectionState.assignCollection}
            onCreateCollection={createCollection}
            onDeleteCollection={(slug) => void deleteCollection(slug)}
            onOpenCollection={openCollection}
            onOpenDocument={selectDocument}
            onOpenSearch={openSearch}
            onOpenView={openWorkspaceView}
            hasMoreDocs={hasMoreDocs}
            loadingMore={loadingMore}
            onLoadMoreDocs={() => void loadMoreDocs()}
            onToggleStar={collectionState.toggleStar}
            onUpdateCollection={updateCollection}
            pendingCollectionSlugs={collectionState.pendingCollectionSlugs}
            pendingDocIds={collectionState.pendingDocIds}
          />
        )}

        {showDocument && docsReady && active?.bodyLoaded && (
          <EditorStatusBar
            activeShared={activeShared}
            mode={mode}
            onExport={exportDoc}
            onModeChange={setMode}
            onShare={shareDoc}
            onUnshare={unshareDoc}
            publicDocPath={publicDocPath}
            saveState={saveState}
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
          onClose={() => setSearchOpen(false)}
          onOpenDocument={selectSearchDocument}
          onQueryChange={setSearchQuery}
          onScopeChange={setSearchScope}
        />
      )}
    </div>
  );
}
