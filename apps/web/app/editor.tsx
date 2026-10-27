"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PendingStatus, useAuth } from "./auth";
import { titleOf, wordCount } from "./doc-utils";
import { formatDocumentCount, isNearDocumentLimit } from "./document-limits";
import { DocumentDrawer } from "./editor-drawer";
import { Doc, isShared, publicIdFromPath, saveLabel } from "./editor-model";
import { currentWorkspaceLocation } from "./editor-workspace-location";
import { useEntitlements } from "./entitlements";
import { MoreIcon, PanelIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";
import { MenuButton, MenuItem } from "./menu-button";
import { Modal } from "./modal";
import { useTheme } from "./theme";
import { useEditorDocuments } from "./use-editor-documents";
import { useEditorSharing } from "./use-editor-sharing";
import { VisualEditor } from "./visual-editor";
import "./writer.css";

// Matches the CSS breakpoint. Below it the document list opens over the page
// instead of beside it.
const OVERLAY_QUERY = "(max-width: 1023px)";
const DRAWER_KEY = "passage.drawer.v1";
// Pointer travel that counts as "the writer reached for the mouse" and brings
// the chrome back. Smaller movements are trackpad noise while typing.
const WAKE_DISTANCE = 6;

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false
  );
}

function storedDrawer() {
  try {
    return localStorage.getItem(DRAWER_KEY) === "open";
  } catch {
    return false;
  }
}

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * The writer. One page of Markdown, a list of every document behind a single
 * button, and nothing else on screen while you type.
 */
export default function Editor() {
  const [source, setSource] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteDialogDocId, setDeleteDialogDocId] = useState("");
  const [shareDialogDocId, setShareDialogDocId] = useState("");
  const [copied, setCopied] = useState(false);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [authError, setAuthError] = useState("");
  // The document the address bar asks for. It can name a document the list
  // has not reached yet, so the page waits for it rather than showing another.
  const [routePublicId, setRoutePublicId] = useState(() => publicIdFromPath());
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const visualRef = useRef<{ focus: () => void }>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusNewDocument = useRef(false);
  const overlay = useMediaQuery(OVERLAY_QUERY);
  const mod = isMac() ? "⌘" : "Ctrl+";

  const auth = useAuth();
  const userId = auth.user?.id;
  const entitlements = useEntitlements();
  const { darkActive, toggleDarkMode } = useTheme();
  const {
    active,
    activeLoadError,
    activeLoading,
    activeId,
    billingNotice,
    billingNoticeAction,
    createDoc,
    deleteDoc: archiveDocument,
    docs,
    documentIndexComplete,
    documentIndexError,
    hasMoreDocs,
    loadMoreDocs,
    loadingMore,
    pendingSave,
    retryActive,
    saveConflict,
    resolveConflict,
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
    focusEditor: () => (source ? textareaRef.current?.focus() : visualRef.current?.focus())
  });

  const activeShared = active ? isShared(active) : false;
  const shareDialogOpen = Boolean(active && shareDialogDocId === active.id);
  const { copyShareLink, exportDoc, publicDocPath, shareDoc, shareState, unshareDoc } = useEditorSharing({
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

  // The drawer remembers whether it was left open, but only where it sits
  // beside the page. Over the page it always starts closed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!window.matchMedia?.(OVERLAY_QUERY).matches && storedDrawer()) setDrawerOpen(true);
  }, []);

  const setDrawer = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (window.matchMedia?.(OVERLAY_QUERY).matches) return;
    try {
      localStorage.setItem(DRAWER_KEY, open ? "open" : "closed");
    } catch {
      // Storage may be unavailable; the drawer still works for this visit.
    }
  }, []);

  const openSearch = useCallback(() => {
    setDrawerOpen(true);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);

  const focusEditor = useCallback(() => {
    requestAnimationFrame(() => (source ? textareaRef.current?.focus() : visualRef.current?.focus()));
  }, [source]);

  // The chrome steps back while you type and returns when you reach for the
  // pointer. It is written to the DOM directly so typing never re-renders the
  // page just to hide a toolbar.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let lastX = -1;
    let lastY = -1;
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".wPage")) return;
      root!.dataset.typing = "true";
    }
    function onPointerMove(event: PointerEvent) {
      if (lastX >= 0 && Math.hypot(event.clientX - lastX, event.clientY - lastY) < WAKE_DISTANCE) return;
      lastX = event.clientX;
      lastY = event.clientY;
      delete root!.dataset.typing;
    }
    function onFocusIn(event: FocusEvent) {
      if (!(event.target as HTMLElement | null)?.closest(".wPage")) delete root!.dataset.typing;
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (modifier && event.key === "/") {
        event.preventDefault();
        setSource((current) => !current);
        return;
      }
      if (modifier && event.key === ".") {
        event.preventDefault();
        setDrawer(!drawerOpen);
        return;
      }
      if (event.key === "Escape" && drawerOpen && overlay) {
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, openSearch, overlay, setDrawer]);

  // Older links carried view and collection queries. Those views are gone.
  useEffect(() => {
    const location = currentWorkspaceLocation();
    if (location.shouldReplace) window.history.replaceState(null, "", location.canonicalPath);
  }, []);

  // A document created from New should be ready to type into. This runs after
  // the editor has actually mounted, which is why it is an effect.
  useEffect(() => {
    if (!focusNewDocument.current) return;
    const element = source ? textareaRef.current : visualRef.current;
    if (!element) return;
    focusNewDocument.current = false;
    element.focus();
  }, [source, activeId, active?.bodyLoaded]);

  // Textareas without field-sizing grow by hand.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element || !source) return;
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [active?.body, source, activeId]);

  useEffect(() => {
    function onPopState() {
      setDeleteDialogDocId("");
      setShareDialogDocId("");
      setRoutePublicId(publicIdFromPath());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Opens the document the address asks for once the list has it. A link to
  // a document that does not exist falls back to the newest one after the
  // whole index has been checked.
  useEffect(() => {
    if (!routePublicId) return;
    const requested = docs.find((doc) => doc.publicId === routePublicId);
    if (requested) {
      if (requested.id !== activeId) selectDoc(requested, "none");
      return;
    }
    if (!documentIndexComplete) return;
    setBillingNotice("That document could not be found.");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoutePublicId("");
    window.history.replaceState(null, "", "/write");
  }, [activeId, docs, documentIndexComplete, routePublicId, selectDoc, setBillingNotice]);

  // The URL follows the open document, so a refresh or a copied address
  // returns to it.
  useEffect(() => {
    if (!active?.publicId || saveState === "loading" || routePublicId) return;
    const path = `/write/${encodeURIComponent(active.publicId)}`;
    if (window.location.pathname === "/write" && !window.location.search) {
      window.history.replaceState(null, "", path);
    }
  }, [active?.publicId, routePublicId, saveState]);

  function newDocument() {
    // Each press would otherwise create its own document.
    if (creatingDocument) return;
    setCreatingDocument(true);
    void createDoc("")
      .then((created) => {
        if (!created) return;
        setRoutePublicId(created.publicId ?? "");
        focusNewDocument.current = true;
        if (overlay) setDrawerOpen(false);
      })
      .finally(() => setCreatingDocument(false));
  }

  function openDocument(doc: Doc) {
    const existing = docs.find((candidate) => candidate.id === doc.id);
    if (!existing) setDocs((current) => [doc, ...current]);
    setRoutePublicId(doc.publicId ?? "");
    selectDoc(existing ?? doc, "push");
    if (overlay) setDrawerOpen(false);
    focusEditor();
  }

  async function deleteDoc(id: string) {
    const replacement = await archiveDocument(id);
    if (replacement === false) return;
    setRoutePublicId(replacement ? replacement.publicId ?? "" : "");
    if (replacement) {
      selectDoc(replacement, "replace");
    } else {
      window.history.replaceState(null, "", "/write");
    }
  }

  // Copies the Markdown itself, the form another tool expects.
  async function copyDocument() {
    if (!active?.bodyLoaded) return;
    try {
      await navigator.clipboard.writeText(active.body);
    } catch {
      window.prompt("Copy this document", active.body);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function signOut() {
    setAuthError("");
    try {
      await auth.signOut();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign out failed");
    }
  }

  const words = active ? wordCount(active.body) : 0;
  const docsReady = saveState !== "loading";
  const savedDocs = auth.account?.usage.savedDocs ?? 0;
  const nearDocumentLimit = entitlements.plan === "pro" && isNearDocumentLimit(savedDocs, entitlements.maxSavedDocs);
  const canDeleteActive = Boolean(active && !activeShared);
  const status = copied || shareState === "copied"
    ? "Copied"
    : shareState === "unshared"
      ? "Sharing off"
      : shareState === "error"
        ? "Share failed"
        : saveState === "saved" || saveState === "loading" ? "" : saveLabel(saveState);
  const routeUnresolved = Boolean(routePublicId && active?.publicId !== routePublicId);
  const ready = docsReady && active?.bodyLoaded && !routeUnresolved;

  const documentItems: MenuItem[] = active ? [
    { label: source ? "Show formatted" : "Show Markdown", hint: `${mod}/`, onSelect: () => setSource(!source) },
    { kind: "separator" },
    { label: "Copy Markdown", onSelect: () => void copyDocument() },
    { label: "Download .md", onSelect: exportDoc },
    activeShared && publicDocPath
      ? { label: "Copy share link", onSelect: () => void copyShareLink() }
      : { label: "Share…", onSelect: () => {
        if (!entitlements.can("shareLinks")) { void shareDoc(); return; }
        setShareDialogDocId(active.id);
      } },
    ...(activeShared ? [{ label: "Sharing settings…", onSelect: () => setShareDialogDocId(active.id) }] : []),
    ...(canDeleteActive ? [
      { kind: "separator" as const },
      { label: "Delete", danger: true, onSelect: () => setDeleteDialogDocId(active.id) }
    ] : [])
  ] : [];

  const accountItems: MenuItem[] = [
    { kind: "note", label: "Signed in as", detail: auth.user?.email },
    { kind: "separator" },
    { label: darkActive ? "Light mode" : "Dark mode", onSelect: toggleDarkMode },
    { kind: "link", label: "Account", href: "/account" },
    { label: "Sign out", onSelect: () => void signOut() }
  ];

  return (
    <div ref={rootRef} className="writer" data-drawer={drawerOpen && !overlay ? "beside" : undefined}>
      <DocumentDrawer
        activeId={active?.id ?? ""}
        docs={docsReady ? docs : []}
        hasMore={hasMoreDocs}
        loadingMore={loadingMore}
        loadError={documentIndexError}
        open={drawerOpen}
        overlay={overlay}
        searchInput={searchRef}
        searchPaused={Boolean(userId && pendingSave)}
        userId={userId}
        onClose={() => setDrawer(false)}
        onLoadMore={() => void loadMoreDocs()}
        onOpen={openDocument}
      />

      <div className="wMain">
        <header className="wBar">
          <div className="wBarGroup">
            <button
              type="button"
              className="wIconButton"
              aria-label="Documents"
              title={`Documents  ${mod}.`}
              aria-expanded={drawerOpen}
              onClick={() => setDrawer(!drawerOpen)}
            >
              <PanelIcon />
            </button>
            {source && (
              <button type="button" className="wModePill" onClick={() => setSource(false)} title={`Show formatted  ${mod}/`}>
                Markdown
              </button>
            )}
          </div>
          <div className="wBarGroup">
            <span className="wStatus" role="status" data-error={saveState === "error" || undefined}>{status}</span>
            <button type="button" className="wIconButton" aria-label="Search" title={`Search  ${mod}K`} onClick={openSearch}>
              <SearchIcon />
            </button>
            <button
              type="button"
              className="wIconButton"
              aria-label="New document"
              title="New document"
              disabled={!docsReady || creatingDocument}
              onClick={newDocument}
            >
              <PlusIcon />
            </button>
            {ready && <MenuButton label="Document actions" icon={<MoreIcon />} items={documentItems} />}
            <MenuButton label="Account" icon={<UserIcon />} items={accountItems} />
          </div>
        </header>

        {(saveConflict && active && saveConflict.id === active.id) ? (
          <div className="wNotice" role="alert">
            <p>
              <strong>This document changed somewhere else.</strong>{" "}
              An agent or another window saved it while you were writing. Nothing has been overwritten.
            </p>
            <div className="wNoticeActions">
              <button type="button" onClick={() => resolveConflict("latest")}>Discard mine, load theirs</button>
              <button type="button" data-primary onClick={() => resolveConflict("overwrite")}>Keep mine, overwrite theirs</button>
            </div>
          </div>
        ) : billingNotice ? (
          <div className="wNotice" role="status">
            <p>{billingNotice}</p>
            <div className="wNoticeActions">
              {billingNoticeAction === "limit" && <Link href="/account#document-limit">Request more</Link>}
              {billingNoticeAction === "upgrade" && <Link href="/account">Upgrade</Link>}
              <button type="button" onClick={() => setBillingNotice("")}>Dismiss</button>
            </div>
          </div>
        ) : nearDocumentLimit ? (
          <div className="wNotice" role="status">
            <p>You&apos;re using {formatDocumentCount(savedDocs)} of {formatDocumentCount(entitlements.maxSavedDocs)} saved documents.</p>
            <div className="wNoticeActions">
              <Link href="/account#document-limit">Request more</Link>
            </div>
          </div>
        ) : null}

        <section className="wPage" aria-label="Markdown editor">
          <div className="wColumn">
            {saveState === "loading" ? (
              <PendingStatus label={routePublicId ? "Loading document" : "Opening your writing"} />
            ) : routeUnresolved ? (
              documentIndexError ? (
                <div className="wEmpty" role="alert">
                  <h1>Document could not be checked.</h1>
                  <p>The address has been kept. Reload to try again.</p>
                </div>
              ) : <PendingStatus label="Loading document" />
            ) : activeLoading ? (
              <PendingStatus label="Opening your writing" />
            ) : documentIndexError && !active ? (
              <div className="wEmpty" role="alert">
                <h1>Your documents could not be loaded.</h1>
                <p>Nothing has changed. Reload to try again.</p>
              </div>
            ) : activeLoadError ? (
              <div className="wEmpty" role="alert">
                <h1>This document could not be opened.</h1>
                <p>Your Markdown has not been changed.</p>
                <button type="button" className="wButton" onClick={retryActive}>Try again</button>
              </div>
            ) : !active ? (
              <div className="wEmpty">
                <h1>A blank page.</h1>
                <p>Everything you write is saved as plain Markdown.</p>
                <button type="button" className="wButton" disabled={creatingDocument} onClick={newDocument}>
                  Start writing
                </button>
              </div>
            ) : source ? (
              <textarea
                key={active.id}
                ref={textareaRef}
                className="wSource"
                aria-label="Markdown editor"
                spellCheck
                placeholder="Start writing."
                value={active.body}
                onChange={(event) => updateBody(event.target.value)}
              />
            ) : (
              <VisualEditor
                key={active.id}
                ref={visualRef}
                source={active.body}
                onChange={updateBody}
                onSource={() => setSource(true)}
              />
            )}
          </div>
        </section>

        {ready && (
          <footer className="wFooter" aria-label="Document details">
            <span>{words === 1 ? "1 word" : `${words.toLocaleString("en-US")} words`}</span>
            {words >= 200 && <span>{Math.max(1, Math.round(words / 230))} min read</span>}
            {activeShared && <span>Shared</span>}
          </footer>
        )}
      </div>

      {authError && <p className="wToast" role="alert">{authError}</p>}

      {shareDialogOpen && active && (
        <DocumentShareDialog
          activeShared={activeShared}
          publicDocPath={publicDocPath}
          title={titleOf(active.body)}
          onClose={() => setShareDialogDocId("")}
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
  onPublish,
  onUnshare
}: {
  activeShared: boolean;
  publicDocPath: string;
  title: string;
  onClose: () => void;
  onPublish: () => Promise<boolean>;
  onUnshare: () => Promise<boolean>;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const shareURL = publicDocPath
    ? new URL(publicDocPath, typeof window === "undefined" ? "https://passage.md" : window.location.origin).toString()
    : "";

  return (
    <Modal ariaLabel="Share document" initialFocus={cancelButton} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Publishing keeps the dialog open so the link is actually shown.
          void onPublish();
        }}
      >
        <h2>{activeShared ? "Shared" : "Share this document"}</h2>
        <p>
          {activeShared
            ? `Anyone with the link can read “${title}”.`
            : `Anyone with the link will be able to read “${title}”. You can turn it off at any time.`}
        </p>
        {activeShared && publicDocPath && (
          <div className="wShareLink">
            <code>{shareURL}</code>
            <Link href={publicDocPath} target="_blank" rel="noreferrer">Open</Link>
          </div>
        )}
        <footer>
          {activeShared && (
            <button
              type="button"
              data-quiet
              onClick={() => {
                onClose();
                void onUnshare();
              }}
            >
              Stop sharing
            </button>
          )}
          <button ref={cancelButton} type="button" onClick={onClose}>Close</button>
          <button type="submit" data-primary>{activeShared ? "Copy link" : "Create link"}</button>
        </footer>
      </form>
    </Modal>
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
    <Modal ariaLabel="Delete document" initialFocus={cancelButton} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
          void onDelete();
        }}
      >
        <h2>Delete “{title}”?</h2>
        <p>It will be removed from Passage, and its share link will stop working.</p>
        <footer>
          <button ref={cancelButton} type="button" onClick={onClose}>Cancel</button>
          <button type="submit" data-danger>Delete</button>
        </footer>
      </form>
    </Modal>
  );
}
