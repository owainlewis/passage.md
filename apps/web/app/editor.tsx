"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PendingStatus, useAuth } from "./auth";
import { bodyWithoutFrontmatter, titleOf, wordCount } from "./doc-utils";
import { formatDocumentCount, isNearDocumentLimit } from "./document-limits";
import { EditorSidebar } from "./editor-sidebar";
import { docMatchesFilter, firstDocInFilter } from "./editor-list";
import { DocumentFilter, isShared, Mode } from "./editor-model";
import { EditorStatusBar } from "./editor-status-bar";
import { useEntitlements } from "./entitlements";
import { PlusIcon, SidebarIcon, UserIcon } from "./icons";
import { MarkdownView } from "./markdown-view";
import { TemplateWorkspace } from "./template-workspace";
import { useEditorDocuments } from "./use-editor-documents";
import { useEditorSharing } from "./use-editor-sharing";
import { useEditorSearch } from "./use-editor-search";
import { useEditorTemplates } from "./use-editor-templates";
import { useEditorTheme } from "./use-editor-theme";

export default function Editor() {
  const [mode, setMode] = useState<Mode>("preview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [authError, setAuthError] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const auth = useAuth();
  const userId = auth.user?.id;
  const entitlements = useEntitlements();
  const { darkActive, theme, toggleDarkMode } = useEditorTheme();
  const templateState = useEditorTemplates(userId);
  const searchRequested = Boolean(userId && filter.trim());
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
    mutationVersion,
    notifyDocumentMutation,
    pendingSave,
    retryActive,
    saveState,
    selectDoc,
    documentFilter,
    setBillingNotice,
    setDocs,
    setPendingSave,
    setSaveState,
    setDocumentFilter,
    togglePin,
    updateBody
  } = useEditorDocuments({
    userId,
    maxSavedDocs: entitlements.maxSavedDocs,
    plan: entitlements.plan,
    focusEditor: () => textareaRef.current?.focus(),
    preserveDocumentFilter: searchRequested
  });

  const search = useEditorSearch({
    query: filter,
    visibility: documentFilter,
    userId,
    mutationVersion
  });
  const searchDocs = search.documents.map((result) => {
    const loaded = docs.find((doc) => doc.id === result.id);
    return loaded?.bodyLoaded
      ? { ...result, body: loaded.body, bodyLoaded: true, pinned: loaded.pinned }
      : { ...result, pinned: loaded?.pinned };
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
    setDocumentFilter,
    onDocumentMutation: notifyDocumentMutation,
    preserveDocumentFilter: searchRequested
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        toggleMode();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMode]);

  async function createDoc(body = "") {
    const created = await createDocument(body);
    if (!created) return false;
    setTemplatesOpen(false);
    setActiveTemplateId("");
    setMode("edit");
    setTagFilter("");
    return true;
  }

  function openTemplates() {
    setTemplatesOpen(true);
    setActiveTemplateId("");
  }

  function selectDocument(doc: Parameters<typeof selectDoc>[0]) {
    setTemplatesOpen(false);
    setActiveTemplateId("");
    selectDoc(doc);
  }

  function selectDocumentFilter(nextFilter: DocumentFilter) {
    setTemplatesOpen(false);
    setActiveTemplateId("");
    if (nextFilter !== documentFilter) {
      clearTagFilter();
    }
    setDocumentFilter(nextFilter);
    if (search.active) return;
    if (active && docMatchesFilter(active, nextFilter)) {
      return;
    }
    const nextDoc = firstDocInFilter(docs, nextFilter);
    if (!nextDoc) return;
    selectDoc(nextDoc);
  }

  function clearTagFilter() {
    setTagFilter("");
  }

  function changeSearch(value: string) {
    setFilter(value);
    if (value.trim()) setTagFilter("");
  }

  function changeTagFilter(value: string) {
    setTagFilter(value);
    if (value.trim()) setFilter("");
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
  const docsReady = saveState !== "loading";
  const showSaveState = saveState !== "saved";
  const savedDocs = auth.account?.usage.savedDocs ?? 0;
  const nearDocumentLimit =
    entitlements.plan === "pro" && isNearDocumentLimit(savedDocs, entitlements.maxSavedDocs);
  const nearDocumentLimitNotice = `You're using ${formatDocumentCount(savedDocs)} of ${formatDocumentCount(entitlements.maxSavedDocs)} saved documents.`;

  return (
    <div className={`workspace ${sidebarOpen ? "withSidebar" : ""}`}>
      <EditorSidebar
        active={active}
        docs={docs}
        docsReady={docsReady}
        filter={filter}
        onClearTagFilter={clearTagFilter}
        onDeleteDoc={(doc) => void deleteDoc(doc.id, doc)}
        onFilterChange={changeSearch}
        onLoadMore={() => search.active ? search.loadMore() : void loadMoreDocs()}
        onOpenTemplates={openTemplates}
        onSelectDoc={selectDocument}
        onDocumentFilterChange={selectDocumentFilter}
        onTagFilterChange={changeTagFilter}
        onToggleDarkMode={toggleDarkMode}
        onTogglePin={(doc) => togglePin(doc.id, doc)}
        saveState={saveState}
        hasMoreDocs={search.active ? search.hasMore : hasMoreDocs}
        loadingMore={search.active ? search.loading : loadingMore}
        documentFilter={documentFilter}
        sidebarOpen={sidebarOpen}
        tagFilter={tagFilter}
        templateCount={templateState.templates.length}
        templatesActive={templatesOpen}
        theme={theme}
        searchActive={search.active}
        searchDocs={searchDocs}
        searchError={search.error}
        onRetrySearch={search.retry}
      />

      <div className="main">
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
              disabled={saveState === "loading"}
              onClick={openTemplates}
            >
              <PlusIcon />
            </button>
          </div>

          <h1 className="docTitle" title={templatesOpen ? "Templates" : docsReady ? title : ""}>
            {templatesOpen ? "Templates" : docsReady ? title : ""}
          </h1>

          <div className="topCluster end">
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
        ) : <section className={`writingPane ${active ? "" : "writingPaneEmpty"}`} aria-label="Markdown editor">
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
        </section>}

        {!templatesOpen && docsReady && active?.bodyLoaded && (
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
    </div>
  );
}
