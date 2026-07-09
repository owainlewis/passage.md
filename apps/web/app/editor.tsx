"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { Brand } from "./brand";
import {
  bodyWithTags,
  bodyWithoutFrontmatter,
  parseTagInput,
  parseTags,
  snippetOf,
  titleOf,
  wordCount
} from "./doc-utils";
import { useEntitlements } from "./entitlements";
import { DocIcon, FolderIcon, PinIcon, PlusIcon, SearchIcon, SidebarIcon, UserIcon } from "./icons";
import { MarkdownView } from "./markdown-view";

type Theme = "light" | "dark";
const THEME_KEY = "passage.theme.v1";

function blockThemeTransitionsForNextPaint() {
  const root = document.documentElement;
  root.dataset.themeTransitionBlocked = "true";
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      delete root.dataset.themeTransitionBlocked;
    });
  });
}

type Doc = {
  id: string;
  publicId?: string;
  body: string;
  pinned?: boolean;
  shareToken?: string | null;
  sharedAt?: string | null;
  updatedAt?: string;
};

function isShared(doc: Doc) {
  return Boolean(doc.sharedAt || doc.shareToken);
}

type Mode = "edit" | "preview";
type ShareState = "idle" | "copied" | "toolong" | "unshared" | "error";
type SaveState = "loading" | "saving" | "saved" | "error";
const PRIVATE_FOLDER = "private";
const SHARED_FOLDER = "shared";

const welcomeBody = `# Markdown for agents and humans

Welcome to passage. This is your sample document and quick guide.
It is pinned, so it stays at the top, and pinned documents cannot be deleted until you unpin them.

## Writing

Just start typing. Everything is saved to your Passage account.

Press **Cmd + R** (or **Ctrl + R**) to switch between **Edit** and **Preview**.
Edit shows raw Markdown. Preview reads like a finished document.

## Your documents

- The sidebar lists every document. Create a new one with the **+** button.
- Use the **Filter** box to find a document by its title or text.
- **Pin** a document to float it to the top. Pinned documents are protected, so to delete one you unpin it first. Try unpinning this guide to reveal its delete button.

## Sharing and export

- **Share** copies a read-only URL you can revoke later.
- **Export** downloads the raw \`.md\` file.

## A finished document

Inline \`code\`, **bold**, and *italic* all render cleanly. Links like [passage.md](https://passage.md) pick up the accent color.

> The best tool for thinking in Markdown should disappear while you write.

\`\`\`ts
export function greet(name: string) {
  return \`Hello, ${"${name}"}\`;
}
\`\`\`

Diagrams render from fenced \`mermaid\` blocks:

\`\`\`mermaid
flowchart LR
  Write([Write Markdown]) --> Preview([Preview])
  Preview --> Share([Share link])
  Preview --> Export([Export .md])
\`\`\`

| Surface | Audience |
| ------- | -------- |
| Browser | Humans   |
| CLI     | Agents   |

Dark mode lives in the sidebar, so the writing surface can stay comfortable in any light.
`;

async function apiDocs(): Promise<Doc[]> {
  const res = await fetch("/api/v1/docs", { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Documents could not be loaded");
  }
  return Array.isArray(body.documents) ? body.documents : [];
}

async function apiCreateDoc(body: string): Promise<Doc> {
  const res = await fetch("/api/v1/docs", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be created");
  }
  return payload as Doc;
}

async function apiUpdateDoc(id: string, body: string): Promise<Doc> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be saved");
  }
  return payload as Doc;
}

async function apiArchiveDoc(id: string): Promise<void> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be archived");
  }
}

type ShareResponse = {
  token: string;
  publicId?: string;
  htmlPath: string;
  markdownPath: string;
};

async function apiShareDoc(id: string): Promise<ShareResponse> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}/share`, {
    method: "POST",
    credentials: "include"
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be shared");
  }
  return payload as ShareResponse;
}

async function apiUnshareDoc(id: string): Promise<void> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}/share`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be unshared");
  }
}

function saveLabel(state: SaveState) {
  switch (state) {
    case "loading":
      return "Loading saved docs";
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "Saved";
  }
}

function seedDocs(): Doc[] {
  return [{ id: "welcome", body: welcomeBody, pinned: true }];
}

function publicIdFromPath() {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/^\/write\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

export default function Editor() {
  const [docs, setDocs] = useState<Doc[]>(seedDocs);
  const [activeId, setActiveId] = useState<string>("welcome");
  const [mode, setMode] = useState<Mode>("preview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedFolder, setSelectedFolder] = useState(PRIVATE_FOLDER);
  const [selectedTag, setSelectedTag] = useState("");
  const [tagDraft, setTagDraft] = useState<{ docId: string; value: string }>({ docId: "", value: "" });
  const [tagError, setTagError] = useState<{ docId: string; message: string }>({ docId: "", message: "" });
  const [theme, setTheme] = useState<Theme>("light");
  const [authError, setAuthError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [pendingSave, setPendingSave] = useState<{ id: string; body: string } | null>(null);
  const [billingNotice, setBillingNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const initialURLPublicId = useRef("");

  const auth = useAuth();
  const entitlements = useEntitlements();
  const darkActive = theme === "dark";

  useEffect(() => {
    initialURLPublicId.current = publicIdFromPath();
    if (window.matchMedia?.("(max-width: 720px)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!auth.user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSave(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSaveState("loading");
      try {
        let savedDocs = await apiDocs();
        if (savedDocs.length === 0) {
          savedDocs = [await apiCreateDoc(welcomeBody)];
        }
        if (cancelled) return;
        const urlDoc = savedDocs.find((doc) => doc.publicId === initialURLPublicId.current);
        setDocs(savedDocs);
        const nextActive = urlDoc ?? savedDocs[0];
        setActiveId(nextActive.id);
        setSelectedFolder(isShared(nextActive) ? SHARED_FOLDER : PRIVATE_FOLDER);
        setSaveState("saved");
        setPendingSave(null);
      } catch {
        if (!cancelled) setSaveState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  useEffect(() => {
    if (!auth.user || !pendingSave) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSaveState("saving");
        try {
          const saved = await apiUpdateDoc(pendingSave.id, pendingSave.body);
          if (cancelled) return;
          setDocs((prev) =>
            prev.map((doc) => (doc.id === saved.id ? { ...saved, pinned: doc.pinned } : doc))
          );
          setSaveState("saved");
          setPendingSave(null);
        } catch {
          if (!cancelled) setSaveState("error");
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingSave, auth.user]);

  // Hydrate the saved theme preference after mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTheme(stored);
      }
    } catch {
      // Storage may be blocked; keep the default theme.
    }
  }, []);

  // Apply the saved theme before paint so the page does not animate between palettes.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (darkActive) {
      root.dataset.theme = "dark";
    } else {
      delete root.dataset.theme;
    }
  }, [darkActive]);

  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  const activeTags = parseTags(active.body);
  const tagDraftValue = tagDraft.docId === active.id ? tagDraft.value : activeTags.join(", ");
  const tagErrorMessage = tagError.docId === active.id ? tagError.message : "";
  const activeShared = isShared(active);
  const publicDocPath = activeShared && active.publicId ? `/d/${active.publicId}` : "";
  const shareButtonLabel =
    shareState === "toolong"
      ? "Too long"
      : shareState === "error"
        ? "Share failed"
        : activeShared
          ? "Shared"
          : shareState === "copied"
            ? "Copied"
            : "Share";

  useEffect(() => {
    if (!auth.user || saveState === "loading" || !active.publicId) return;
    const nextPath = `/write/${encodeURIComponent(active.publicId)}`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, "", nextPath);
    }
  }, [active.id, active.publicId, auth.user, saveState]);

  // Grow the textarea with its content so the pane scrolls as one surface.
  // Modern browsers do this natively with `field-sizing: content`, which avoids
  // the per-keystroke height thrashing that left a ghost caret in Chrome. Only
  // fall back to JS resizing where field-sizing is unsupported.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || mode !== "edit") return;
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [active.body, mode, activeId]);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "edit" ? "preview" : "edit"));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        toggleMode();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMode]);

  function updateBody(body: string) {
    setSaveState("saving");
    setPendingSave({ id: active.id, body });
    setDocs((prev) => prev.map((d) => (d.id === active.id ? { ...d, body } : d)));
  }

  function updateEditorURL(doc: Doc, mode: "push" | "replace") {
    if (!doc.publicId) return;
    const nextPath = `/write/${encodeURIComponent(doc.publicId)}`;
    if (window.location.pathname === nextPath) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextPath);
  }

  function selectDoc(doc: Doc) {
    setActiveId(doc.id);
    updateEditorURL(doc, "push");
  }

  function saveTags(input = tagDraftValue) {
    const parsed = parseTagInput(input);
    if (parsed.invalid.length > 0) {
      setTagError({ docId: active.id, message: "Use lowercase a-z and hyphen only." });
      return;
    }
    setTagError({ docId: active.id, message: "" });
    setTagDraft({ docId: active.id, value: parsed.tags.join(", ") });
    updateBody(bodyWithTags(active.body, parsed.tags));
  }

  async function createDoc() {
    if (docs.length >= entitlements.maxSavedDocs) {
      const prefix = entitlements.plan === "free" ? "Free includes" : "Your plan includes";
      setBillingNotice(`${prefix} ${entitlements.maxSavedDocs} saved documents. Upgrade for more.`);
      return;
    }
    setBillingNotice("");
    setSaveState("saving");
    try {
      const doc = await apiCreateDoc("");
      setDocs((prev) => [doc, ...prev]);
      setActiveId(doc.id);
      updateEditorURL(doc, "push");
      setMode("edit");
      setFilter("");
      setSelectedFolder(PRIVATE_FOLDER);
      setSelectedTag("");
      setSaveState("saved");
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      setBillingNotice(err instanceof Error ? err.message : "Document could not be created");
      setSaveState("error");
    }
  }

  function togglePin(id: string) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, pinned: !d.pinned } : d)));
  }

  async function deleteDoc(id: string) {
    // Pinned documents are protected from deletion; unpin first to remove one.
    const doc = docs.find((d) => d.id === id);
    if (!doc || doc.pinned || isShared(doc)) return;
    setSaveState("saving");
    try {
      await apiArchiveDoc(id);
    } catch {
      setSaveState("error");
      return;
    }
    setDocs((prev) => {
      const next = prev.filter((d) => d.id !== id);
      const remaining = next.length > 0 ? next : seedDocs();
      const selectedFolderHasDocs = remaining.some((remainingDoc) => docMatchesFolder(remainingDoc, selectedFolder));
      const replacement =
        remaining.find((remainingDoc) => remainingDoc.id === activeId) ??
        remaining.find((remainingDoc) => docMatchesFolder(remainingDoc, selectedFolder)) ??
        remaining[0];
      if (id === activeId) {
        setActiveId(replacement.id);
        updateEditorURL(replacement, "replace");
      }
      if (!selectedFolderHasDocs) {
        setSelectedFolder(isShared(replacement) ? SHARED_FOLDER : PRIVATE_FOLDER);
      }
      return remaining;
    });
    setSaveState("saved");
  }

  function exportDoc() {
    if (!entitlements.can("exportMarkdown")) {
      setBillingNotice("Export is a Pro feature.");
      return;
    }
    setBillingNotice("");
    const blob = new Blob([active.body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${titleOf(active.body).replace(/[^\w.-]+/g, "-").toLowerCase() || "untitled"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function shareDoc() {
    if (!entitlements.can("shareLinks")) {
      setBillingNotice("Sharing and raw .md URLs are Pro features.");
      return;
    }
    setBillingNotice("");
    window.clearTimeout(copyTimer.current);
    try {
      if (pendingSave?.id === active.id) {
        setSaveState("saving");
        const saved = await apiUpdateDoc(pendingSave.id, pendingSave.body);
        setDocs((prev) => prev.map((doc) => (doc.id === saved.id ? { ...saved, pinned: doc.pinned } : doc)));
        setPendingSave(null);
        setSaveState("saved");
      }
      let htmlPath = activeShared && active.publicId ? `/d/${active.publicId}` : "";
      if (!htmlPath) {
        const share = await apiShareDoc(active.id);
        const updatedAt = new Date().toISOString();
        htmlPath = share.htmlPath;
        setDocs((prev) =>
          prev.map((doc) =>
            doc.id === active.id
              ? { ...doc, publicId: share.publicId ?? doc.publicId, shareToken: share.token, sharedAt: updatedAt, updatedAt }
              : doc
          )
        );
      }
      await copyURL(new URL(htmlPath, window.location.origin).toString());
      setSelectedFolder(SHARED_FOLDER);
      setShareState("copied");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      setShareState("error");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  async function copyURL(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this share link", url);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy this token", text);
    }
  }

  async function unshareDoc() {
    if (!activeShared) return;
    window.clearTimeout(copyTimer.current);
    try {
      await apiUnshareDoc(active.id);
      const updatedAt = new Date().toISOString();
      setDocs((prev) =>
        prev.map((doc) => (doc.id === active.id ? { ...doc, shareToken: null, sharedAt: null, updatedAt } : doc))
      );
      setSelectedFolder(PRIVATE_FOLDER);
      setShareState("unshared");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      setShareState("error");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  function toggleDarkMode() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    blockThemeTransitionsForNextPaint();
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable; the choice stays in memory for this session.
    }
  }

  async function signOut() {
    setAuthError("");
    try {
      await auth.signOut();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign out failed");
    }
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  const words = wordCount(active.body);
  const title = titleOf(active.body);
  const sidebarTags = Array.from(new Set(docs.flatMap((doc) => parseTags(doc.body)))).sort();
  const folderRows = [
    { id: PRIVATE_FOLDER, label: "Private", count: docs.filter((doc) => !isShared(doc)).length },
    { id: SHARED_FOLDER, label: "Shared", count: docs.filter(isShared).length }
  ];

  function docMatchesFolder(doc: Doc, folderId: string) {
    if (folderId === SHARED_FOLDER) return isShared(doc);
    return !isShared(doc);
  }

  // Naive in-memory search over title, body, and tags.
  const query = filter.trim().toLowerCase();
  const indexedDocs = docs.map((doc, index) => ({ doc, index }));
  const compareDocsBySidebarOrder = (a: (typeof indexedDocs)[number], b: (typeof indexedDocs)[number]) => {
    const pinned = Number(Boolean(b.doc.pinned)) - Number(Boolean(a.doc.pinned));
    if (pinned) return pinned;
    const aUpdated = a.doc.updatedAt ? Date.parse(a.doc.updatedAt) : 0;
    const bUpdated = b.doc.updatedAt ? Date.parse(b.doc.updatedAt) : 0;
    if (aUpdated || bUpdated) return bUpdated - aUpdated;
    return a.index - b.index;
  };
  const visibleDocs = indexedDocs
    .filter(({ doc }) => {
      const tags = parseTags(doc.body);
      if (!docMatchesFolder(doc, selectedFolder)) return false;
      if (selectedTag && !tags.includes(selectedTag)) return false;
      if (!query) return true;
      return (
        titleOf(doc.body).toLowerCase().includes(query) ||
        bodyWithoutFrontmatter(doc.body).toLowerCase().includes(query) ||
        tags.some((tag) => tag.includes(query))
      );
    })
    .sort(compareDocsBySidebarOrder)
    .map(({ doc }) => doc);

  function selectFolder(folderId: string) {
    if (docMatchesFolder(active, folderId)) {
      setSelectedFolder(folderId);
      return;
    }
    const nextDoc = indexedDocs
      .filter(({ doc }) => docMatchesFolder(doc, folderId))
      .sort(compareDocsBySidebarOrder)[0]?.doc;
    if (!nextDoc) return;
    setSelectedFolder(folderId);
    selectDoc(nextDoc);
  }

  if (saveState === "loading") {
    return <main className="routeStatus">Loading saved docs</main>;
  }

  return (
    <div className={`workspace ${sidebarOpen ? "withSidebar" : ""}`}>
      <aside className="sidebar" aria-label="Documents" data-open={sidebarOpen}>
        <div className="sidebarHead">
          <Brand href="/write" />
        </div>
        <div className="filterRow">
          <div className="filterField">
            <span className="filterIcon">
              <SearchIcon />
            </span>
            <input
              className="filterInput"
              type="text"
              name="filter-documents"
              placeholder="Filter"
              aria-label="Search documents and tags"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="folderFilter" aria-label="Folders">
          <div className="tagFilterHead">
            <span>Folders</span>
          </div>
          <div className="folderList">
            {folderRows.map((folder) => {
              const activeFolderFilter = selectedFolder === folder.id;
              const disabled = folder.count === 0;
              return (
                <div
                  key={folder.id || "all-documents"}
                  className={`folderRow ${activeFolderFilter ? "active" : ""} ${disabled ? "disabled" : ""}`}
                >
                  <button
                    type="button"
                    className="folderRowSelect"
                    disabled={disabled}
                    aria-current={activeFolderFilter ? "page" : undefined}
                    aria-label={`Open ${folder.label} folder`}
                    onClick={() => selectFolder(folder.id)}
                  >
                    <span className="folderRowIcon">
                      <FolderIcon />
                    </span>
                    <span className="folderRowName">{folder.label}</span>
                    <span className="folderRowCount" aria-hidden="true">
                      {folder.count}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {sidebarTags.length > 0 && (
          <div className="tagFilter" aria-label="Filter by tag">
            <div className="tagFilterHead">
              <span>Tags</span>
              {selectedTag && (
                <button type="button" className="tagFilterClear" onClick={() => setSelectedTag("")}>
                  Clear
                </button>
              )}
            </div>
            <div className="tagFilterList">
              {sidebarTags.map((tag) => {
                const activeTag = selectedTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`tagFilterChip ${activeTag ? "active" : ""}`}
                    aria-pressed={activeTag}
                    onClick={() => setSelectedTag((current) => (current === tag ? "" : tag))}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="docListLabel">
          <span>Documents</span>
          <span className="docCount">{visibleDocs.length}</span>
        </div>
        <nav className="docList">
          {visibleDocs.map((doc) => {
            const isActive = doc.id === active.id;
            return (
              <div
                key={doc.id}
                className={`docRow ${isActive ? "active" : ""} ${doc.pinned ? "pinned" : ""}`}
              >
                <button type="button" className="docRowSelect" onClick={() => selectDoc(doc)}>
                  <span className="docRowIcon">
                    <DocIcon />
                  </span>
                  <span className="docRowText">
                    <span className="docRowTitle">{titleOf(doc.body)}</span>
                    <span className="docRowSnippet">{snippetOf(doc.body)}</span>
                  </span>
                </button>
                <span className="docRowActions">
                  <button
                    type="button"
                    className="docRowPin"
                    aria-label={doc.pinned ? "Unpin document" : "Pin document"}
                    onClick={() => togglePin(doc.id)}
                  >
                    <PinIcon filled={Boolean(doc.pinned)} />
                  </button>
                  {docs.length > 1 && !doc.pinned && !isShared(doc) && (
                    <button
                      type="button"
                      className="docRowDelete"
                      aria-label="Delete document"
                      onClick={() => deleteDoc(doc.id)}
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {visibleDocs.length === 0 && <p className="docListEmpty">No documents match.</p>}
        </nav>
        <div className="sidebarFoot">
          <div className="tagEditor">
            <label className="tagField">
              <span>Doc tags</span>
              <input
                className="tagInput"
                type="text"
                name="document-tags"
                placeholder="notes, scripts"
                aria-label="Document tags"
                aria-invalid={tagErrorMessage ? "true" : "false"}
                value={tagDraftValue}
                onChange={(e) => setTagDraft({ docId: active.id, value: e.target.value })}
                onBlur={(e) => saveTags(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
              />
            </label>
            {tagErrorMessage && <p className="tagError">{tagErrorMessage}</p>}
          </div>
          <div className="themeToggle">
            <span className={theme === "light" ? "themeLabel active" : "themeLabel"}>Light</span>
            <button
              type="button"
              role="switch"
              aria-checked={darkActive}
              aria-label="Dark mode"
              className={`switch ${darkActive ? "on" : ""}`}
              onClick={toggleDarkMode}
            >
              <span className="switchKnob" />
            </button>
            <span className={theme === "dark" ? "themeLabel active" : "themeLabel"}>Dark</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topBar">
          <div className="topCluster">
            <button
              type="button"
              className="iconButton"
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarOpen}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <SidebarIcon />
            </button>
            <button type="button" className="iconButton" aria-label="New document" onClick={createDoc}>
              <PlusIcon />
            </button>
          </div>

          <h1 className="docTitle" title={title}>
            {title}
          </h1>

          <div className="topCluster end">
            <div className="modeToggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={mode === "edit" ? "on" : ""}
                aria-pressed={mode === "edit"}
                onClick={() => setMode("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className={mode === "preview" ? "on" : ""}
                aria-pressed={mode === "preview"}
                onClick={() => setMode("preview")}
              >
                Preview
              </button>
            </div>
            <button
              type="button"
              className="textButton shareToggle"
              aria-pressed={activeShared}
              onClick={() => void (activeShared ? unshareDoc() : shareDoc())}
              title={
                shareState === "toolong"
                  ? "This document is too long to share as a link"
                  : activeShared
                    ? "Click to unshare"
                    : undefined
              }
            >
              {shareButtonLabel}
            </button>
            {publicDocPath && (
              <Link
                className="textButton publicDocLink"
                href={publicDocPath}
                target="_blank"
                rel="noreferrer"
                aria-label="Open public document"
              >
                View
              </Link>
            )}
            <button type="button" className="textButton" onClick={exportDoc}>
              Export
            </button>
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

        {billingNotice && (
          <div className="billingNotice">
            <span>{billingNotice}</span>
            <Link href="/account">Upgrade</Link>
          </div>
        )}

        <section className="writingPane" aria-label="Markdown editor">
          {mode === "edit" ? (
            <textarea
              ref={textareaRef}
              className="editor"
              aria-label="Markdown editor"
              aria-multiline="true"
              spellCheck
              placeholder="Start writing Markdown."
              value={active.body}
              onChange={(e) => updateBody(e.target.value)}
            />
          ) : (
            <MarkdownView source={bodyWithoutFrontmatter(active.body)} theme={darkActive ? "dark" : "light"} />
          )}
        </section>

        <footer className="statusBar" aria-label="Editor status">
          <span className="statusMode">{mode === "edit" ? "Editing" : "Preview"}</span>
          <span className="statusWords">{words === 1 ? "1 word" : `${words} words`}</span>
          <span className="statusSave">
            <span className="saveDot" aria-hidden="true" />
            {saveLabel(saveState)}
          </span>
        </footer>
      </div>
    </div>
  );
}
