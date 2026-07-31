"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PendingStatus, useAuth } from "./auth";
import { bodyWithoutFrontmatter, titleOf, wordCount } from "./doc-utils";
import { formatDocumentCount, isNearDocumentLimit } from "./document-limits";
import { EditorSidebar } from "./editor-sidebar";
import { firstDocInFolder, docMatchesFolder } from "./editor-list";
import { isShared, Mode } from "./editor-model";
import { EditorStatusBar } from "./editor-status-bar";
import { useEntitlements } from "./entitlements";
import { PlusIcon, SidebarIcon, UserIcon } from "./icons";
import { MarkdownView } from "./markdown-view";
import { useEditorDocuments } from "./use-editor-documents";
import { useEditorSharing } from "./use-editor-sharing";
import { useEditorTheme } from "./use-editor-theme";

export default function Editor() {
  const [mode, setMode] = useState<Mode>("preview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [authError, setAuthError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const auth = useAuth();
  const userId = auth.user?.id;
  const entitlements = useEntitlements();
  const { darkActive, theme, toggleDarkMode } = useEditorTheme();
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
    selectedFolder,
    setBillingNotice,
    setDocs,
    setPendingSave,
    setSaveState,
    setSelectedFolder,
    togglePin,
    updateBody
  } = useEditorDocuments({
    userId,
    maxSavedDocs: entitlements.maxSavedDocs,
    plan: entitlements.plan,
    focusEditor: () => textareaRef.current?.focus()
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
    setSelectedFolder
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

  async function createDoc() {
    const created = await createDocument();
    if (!created) return;
    setMode("edit");
    setFilter("");
    setTagFilter("");
  }

  function selectFolder(folderId: string) {
    if (folderId !== selectedFolder) {
      clearTagFilter();
    }
    if (active && docMatchesFolder(active, folderId)) {
      setSelectedFolder(folderId);
      return;
    }
    const nextDoc = firstDocInFolder(docs, folderId);
    if (!nextDoc) return;
    setSelectedFolder(folderId);
    selectDoc(nextDoc);
  }

  function clearTagFilter() {
    setTagFilter("");
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
        onDeleteDoc={(id) => void deleteDoc(id)}
        onFilterChange={setFilter}
        onLoadMore={() => void loadMoreDocs()}
        onSelectDoc={selectDoc}
        onSelectFolder={selectFolder}
        onTagFilterChange={setTagFilter}
        onToggleDarkMode={toggleDarkMode}
        onTogglePin={togglePin}
        saveState={saveState}
        hasMoreDocs={hasMoreDocs}
        loadingMore={loadingMore}
        selectedFolder={selectedFolder}
        sidebarOpen={sidebarOpen}
        tagFilter={tagFilter}
        theme={theme}
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
              onClick={() => void createDoc()}
            >
              <PlusIcon />
            </button>
          </div>

          <h1 className="docTitle" title={docsReady ? title : ""}>
            {docsReady ? title : ""}
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

        <section className={`writingPane ${active ? "" : "writingPaneEmpty"}`} aria-label="Markdown editor">
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
              <button type="button" className="emptyDocumentsCreate" onClick={() => void createDoc()}>
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
        </section>

        {docsReady && active?.bodyLoaded && (
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
