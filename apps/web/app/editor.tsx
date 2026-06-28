"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { Brand } from "./brand";
import { snippetOf, titleOf, wordCount } from "./doc-utils";
import { useEntitlements } from "./entitlements";
import { DocIcon, PinIcon, PlusIcon, SearchIcon, SidebarIcon, UserIcon } from "./icons";
import { MarkdownView } from "./markdown-view";
import { encodeDoc } from "./share";

type Theme = "light" | "dark";
const THEME_KEY = "passage.theme.v1";

type Doc = {
  id: string;
  body: string;
  pinned?: boolean;
  shareToken?: string | null;
  sharedAt?: string | null;
};

type APIToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

type Mode = "edit" | "preview";
type ShareState = "idle" | "copied" | "toolong" | "unshared" | "error";
type SaveState = "local" | "loading" | "saving" | "saved" | "error";
type TokenStatus = "idle" | "loading" | "creating" | "revoking" | "copied" | "error";

const STORAGE_KEY = "passage.documents.v2";
const ACTIVE_KEY = "passage.active.v2";

// Anonymous share links carry the whole document in the URL fragment. Past a
// point the link grows too long to paste reliably, so guard the length and tell
// the user rather than handing back a link that silently breaks on paste.
const MAX_SHARE_URL_LENGTH = 16000;

const welcomeBody = `# Markdown for agents and humans

Welcome to passage. This is your sample document and quick guide.
It is pinned, so it stays at the top, and pinned documents cannot be deleted until you unpin them.

## Writing

Just start typing. Everything is saved locally in this browser until you choose to share or export it.

Press **Cmd + R** (or **Ctrl + R**) to switch between **Edit** and **Preview**.
Edit shows raw Markdown. Preview reads like a finished document.

## Your documents

- The sidebar lists every document. Create a new one with the **+** button.
- Use the **Filter** box to find a document by its title or text.
- **Pin** a document to float it to the top. Pinned documents are protected, so to delete one you unpin it first. Try unpinning this guide to reveal its delete button.

## Sharing and export

- **Share** copies a private link. The document travels inside the link, so only people you send it to can read it.
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

Dark mode lives in the account menu and is part of passage Pro.
`;

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

async function apiTokens(): Promise<APIToken[]> {
  const res = await fetch("/api/v1/api-tokens", { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "API tokens could not be loaded");
  }
  return Array.isArray(body.tokens) ? body.tokens : [];
}

async function apiCreateToken(name: string): Promise<{ token: string; apiToken: APIToken }> {
  const res = await fetch("/api/v1/api-tokens", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "API token could not be created");
  }
  return payload as { token: string; apiToken: APIToken };
}

async function apiRevokeToken(id: string): Promise<void> {
  const res = await fetch(`/api/v1/api-tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "API token could not be revoked");
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
    case "local":
    default:
      return "Saved locally";
  }
}

function formatTokenDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function seedDocs(): Doc[] {
  return [{ id: "welcome", body: welcomeBody, pinned: true }];
}

export default function Editor() {
  const [docs, setDocs] = useState<Doc[]>(seedDocs);
  const [activeId, setActiveId] = useState<string>("welcome");
  const [mode, setMode] = useState<Mode>("preview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [hydrated, setHydrated] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("local");
  const [pendingSave, setPendingSave] = useState<{ id: string; body: string } | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [tokenName, setTokenName] = useState("CLI");
  const [createdToken, setCreatedToken] = useState("");
  const [createdTokenId, setCreatedTokenId] = useState("");
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("idle");
  const [tokenError, setTokenError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const tokenCreateGeneration = useRef(0);
  const tokenMutationGeneration = useRef(0);
  const currentUserId = useRef<string | null>(null);

  const auth = useAuth();
  const signedIn = Boolean(auth.user);
  const { plan, setPlan, can } = useEntitlements();
  const canDark = can("darkMode");
  const darkActive = canDark && theme === "dark";

  useEffect(() => {
    currentUserId.current = auth.user?.id ?? null;
  }, [auth.user]);

  useEffect(() => {
    if (window.matchMedia?.("(max-width: 720px)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSidebarOpen(false);
    }
  }, []);

  // Load persisted state after mount so SSR and the first client render match.
  useEffect(() => {
    if (auth.loading) return;
    if (signedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHydrated(true);
      setLocalReady(false);
      return;
    }
    let nextDocs = seedDocs();
    let nextActive = nextDocs[0].id;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const storedActive = localStorage.getItem(ACTIVE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Doc[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          nextDocs = parsed;
          nextActive = storedActive && parsed.some((d) => d.id === storedActive) ? storedActive : parsed[0].id;
        }
      }
    } catch {
      // Ignore corrupt storage and keep the seeded document.
    }
    // Reading localStorage must happen after mount to avoid a hydration
    // mismatch, so this one-time sync from storage is intentional.
    setDocs(nextDocs);
    setActiveId(nextActive);
    setHydrated(true);
    setLocalReady(true);
    setSaveState("local");
  }, [auth.loading, signedIn]);

  useEffect(() => {
    if (!hydrated || !localReady || auth.loading || signedIn) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
      localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      // Storage may be unavailable (private mode); drafts stay in memory.
    }
  }, [docs, activeId, hydrated, localReady, auth.loading, signedIn]);

  useEffect(() => {
    if (!auth.user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSave(null);
      tokenCreateGeneration.current += 1;
      setTokens([]);
      setCreatedToken("");
      setCreatedTokenId("");
      setTokenError("");
      setTokenStatus("idle");
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
        setDocs(savedDocs);
        setActiveId(savedDocs[0].id);
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
    if (!auth.user || !menuOpen) return;
    let cancelled = false;
    const mutationGeneration = tokenMutationGeneration.current;
    (async () => {
      setTokenStatus((current) => (current === "creating" || current === "revoking" ? current : "loading"));
      setTokenError("");
      try {
        const loaded = await apiTokens();
        if (cancelled) return;
        if (tokenMutationGeneration.current === mutationGeneration) {
          setTokens(loaded);
        }
        setTokenStatus((current) => (current === "loading" ? "idle" : current));
      } catch (err) {
        if (cancelled) return;
        setTokenError(err instanceof Error ? err.message : "API tokens could not be loaded");
        setTokenStatus((current) => (current === "loading" ? "error" : current));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user, menuOpen]);

  useEffect(() => {
    if (!signedIn || !pendingSave) return;
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
  }, [pendingSave, signedIn]);

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

  // Apply dark mode to the document only when the plan entitles it.
  useEffect(() => {
    const root = document.documentElement;
    if (darkActive) {
      root.dataset.theme = "dark";
    } else {
      delete root.dataset.theme;
    }
  }, [darkActive]);

  const active = docs.find((d) => d.id === activeId) ?? docs[0];

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
    if (signedIn) {
      setSaveState("saving");
      setPendingSave({ id: active.id, body });
    }
    setDocs((prev) => prev.map((d) => (d.id === active.id ? { ...d, body } : d)));
  }

  async function createDoc() {
    setSaveState(signedIn ? "saving" : "local");
    try {
      const doc = signedIn ? await apiCreateDoc("") : { id: newId(), body: "" };
      setDocs((prev) => [doc, ...prev]);
      setActiveId(doc.id);
      setMode("edit");
      setFilter("");
      setSaveState(signedIn ? "saved" : "local");
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch {
      setSaveState("error");
    }
  }

  function togglePin(id: string) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, pinned: !d.pinned } : d)));
  }

  async function deleteDoc(id: string) {
    // Pinned documents are protected from deletion; unpin first to remove one.
    if (docs.find((d) => d.id === id)?.pinned) return;
    setSaveState(signedIn ? "saving" : "local");
    if (signedIn) {
      try {
        await apiArchiveDoc(id);
      } catch {
        setSaveState("error");
        return;
      }
    }
    setDocs((prev) => {
      const next = prev.filter((d) => d.id !== id);
      const remaining = next.length > 0 ? next : seedDocs();
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
    setSaveState(signedIn ? "saved" : "local");
  }

  function exportDoc() {
    const blob = new Blob([active.body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${titleOf(active.body).replace(/[^\w.-]+/g, "-").toLowerCase() || "untitled"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function shareDoc() {
    window.clearTimeout(copyTimer.current);
    try {
      if (signedIn) {
        if (pendingSave?.id === active.id) {
          setSaveState("saving");
          const saved = await apiUpdateDoc(pendingSave.id, pendingSave.body);
          setDocs((prev) => prev.map((doc) => (doc.id === saved.id ? { ...saved, pinned: doc.pinned } : doc)));
          setPendingSave(null);
          setSaveState("saved");
        }
        let htmlPath = active.shareToken ? `/d/${active.shareToken}` : "";
        if (!htmlPath) {
          const share = await apiShareDoc(active.id);
          htmlPath = share.htmlPath;
          setDocs((prev) =>
            prev.map((doc) =>
              doc.id === active.id
                ? { ...doc, shareToken: share.token, sharedAt: new Date().toISOString() }
                : doc
            )
          );
        }
        await copyURL(new URL(htmlPath, window.location.origin).toString());
      } else {
        const url = `${window.location.origin}/d#${await encodeDoc(active.body)}`;
        if (url.length > MAX_SHARE_URL_LENGTH) {
          setShareState("toolong");
          copyTimer.current = window.setTimeout(() => setShareState("idle"), 2400);
          return;
        }
        await copyURL(url);
      }
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
    if (!signedIn || !active.shareToken) return;
    window.clearTimeout(copyTimer.current);
    try {
      await apiUnshareDoc(active.id);
      setDocs((prev) =>
        prev.map((doc) => (doc.id === active.id ? { ...doc, shareToken: null, sharedAt: null } : doc))
      );
      setShareState("unshared");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      setShareState("error");
      copyTimer.current = window.setTimeout(() => setShareState("idle"), 2400);
    }
  }

  function toggleDarkMode() {
    if (!canDark) return;
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable; the choice stays in memory for this session.
    }
  }

  async function submitAuth(action: "login" | "register") {
    setAuthError("");
    try {
      if (action === "login") {
        await auth.signIn(authEmail, authPassword);
      } else {
        await auth.register(authEmail, authPassword);
      }
      setAuthPassword("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed");
    }
  }

  async function signOut() {
    setAuthError("");
    tokenCreateGeneration.current += 1;
    currentUserId.current = null;
    setTokens([]);
    setCreatedToken("");
    setCreatedTokenId("");
    try {
      await auth.signOut();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign out failed");
    }
  }

  async function createToken() {
    if (tokenStatus === "creating" || tokenStatus === "revoking") return;
    const name = tokenName.trim();
    if (!name) {
      setTokenError("Token name is required");
      setTokenStatus("error");
      return;
    }
    setTokenError("");
    setTokenStatus("creating");
    tokenMutationGeneration.current += 1;
    const generation = tokenCreateGeneration.current;
    const ownerId = auth.user?.id ?? null;
    try {
      const created = await apiCreateToken(name);
      if (tokenCreateGeneration.current !== generation) {
        if (ownerId && currentUserId.current === ownerId) {
          setTokens((prev) => [created.apiToken, ...prev.filter((token) => token.id !== created.apiToken.id)]);
        }
        setTokenStatus("idle");
        return;
      }
      setTokens((prev) => [created.apiToken, ...prev.filter((token) => token.id !== created.apiToken.id)]);
      setCreatedToken(created.token);
      setCreatedTokenId(created.apiToken.id);
      setTokenName("CLI");
      await copyText(created.token);
      setTokenStatus("copied");
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "API token could not be created");
      setTokenStatus("error");
    }
  }

  async function copyCreatedToken() {
    if (!createdToken) return;
    setTokenError("");
    try {
      await copyText(createdToken);
      setTokenStatus("copied");
    } catch {
      setTokenError("Token could not be copied");
      setTokenStatus("error");
    }
  }

  async function revokeToken(id: string) {
    if (tokenStatus === "creating" || tokenStatus === "revoking") return;
    setTokenError("");
    setTokenStatus("revoking");
    tokenMutationGeneration.current += 1;
    try {
      await apiRevokeToken(id);
      setTokens((prev) => prev.filter((token) => token.id !== id));
      setTokenStatus("idle");
      if (id === createdTokenId) {
        setCreatedToken("");
        setCreatedTokenId("");
      }
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "API token could not be revoked");
      setTokenStatus("error");
    }
  }

  function closeMenu() {
    tokenCreateGeneration.current += 1;
    setMenuOpen(false);
    setCreatedToken("");
    setCreatedTokenId("");
  }

  const words = wordCount(active.body);
  const title = titleOf(active.body);

  // Naive in-memory filter over title and body, with pinned docs floated up.
  // Array.sort is stable, so unpinned docs keep their existing order.
  const query = filter.trim().toLowerCase();
  const visibleDocs = docs
    .filter((d) => !query || titleOf(d.body).toLowerCase().includes(query) || d.body.toLowerCase().includes(query))
    .slice()
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return (
    <div className={`workspace ${sidebarOpen ? "withSidebar" : ""}`}>
      <aside className="sidebar" aria-label="Documents" data-open={sidebarOpen}>
        <div className="sidebarHead">
          <Brand href="/" />
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
              aria-label="Filter documents"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="docListLabel">
          <span>Documents</span>
          <span className="docCount">{docs.length}</span>
        </div>
        <nav className="docList">
          {visibleDocs.map((doc) => {
            const isActive = doc.id === active.id;
            return (
              <div
                key={doc.id}
                className={`docRow ${isActive ? "active" : ""} ${doc.pinned ? "pinned" : ""}`}
              >
                <button type="button" className="docRowSelect" onClick={() => setActiveId(doc.id)}>
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
                  {docs.length > 1 && !doc.pinned && (
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
              className="textButton"
              onClick={shareDoc}
              title={shareState === "toolong" ? "This document is too long to share as a link" : undefined}
            >
              {shareState === "copied"
                ? "Copied"
                : shareState === "toolong"
                  ? "Too long"
                  : shareState === "error"
                    ? "Share failed"
                    : "Share"}
            </button>
            {signedIn && active.shareToken && (
              <button type="button" className="textButton" onClick={unshareDoc}>
                {shareState === "unshared" ? "Unshared" : "Unshare"}
              </button>
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
                    {auth.user ? (
                      <>
                        <div className="menuAccount">
                          <span className="menuAccountLabel">Signed in</span>
                          <span className="menuAccountEmail">{auth.user.email}</span>
                        </div>
                        {authError && <p className="authError">{authError}</p>}
                        <button type="button" className="menuItem" role="menuitem" onClick={() => void signOut()}>
                          Sign out
                        </button>
                        <div className="menuDivider" />
                        <section className="tokenPanel" aria-label="API tokens">
                          <div className="tokenPanelHead">
                            <span className="tokenTitle">API tokens</span>
                            {tokenStatus === "loading" && <span className="tokenMeta">Loading</span>}
                          </div>
                          <label className="tokenField">
                            <span>Name</span>
                            <input
                              className="authInput"
                              type="text"
                              name="api-token-name"
                              value={tokenName}
                              maxLength={80}
                              onChange={(e) => setTokenName(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="menuItem accent"
                            disabled={tokenStatus === "creating" || tokenStatus === "revoking"}
                            onClick={() => void createToken()}
                          >
                            {tokenStatus === "creating" ? "Creating" : "Create token"}
                          </button>
                          {createdToken && (
                            <div className="createdToken">
                              <span className="createdTokenLabel">Copy now</span>
                              <code>{createdToken}</code>
                              <button type="button" className="tokenCopy" onClick={() => void copyCreatedToken()}>
                                {tokenStatus === "copied" ? "Copied" : "Copy"}
                              </button>
                            </div>
                          )}
                          {tokenError && <p className="authError">{tokenError}</p>}
                          <div className="tokenList">
                            {tokens.map((token) => (
                              <div className="tokenRow" key={token.id}>
                                <span className="tokenInfo">
                                  <span className="tokenName">{token.name}</span>
                                  <span className="tokenMeta">Created {formatTokenDate(token.createdAt)}</span>
                                </span>
                                <button
                                  type="button"
                                  className="tokenRevoke"
                                  onClick={() => void revokeToken(token.id)}
                                  disabled={tokenStatus === "creating" || tokenStatus === "revoking"}
                                >
                                  Revoke
                                </button>
                              </div>
                            ))}
                            {tokenStatus !== "loading" && tokens.length === 0 && (
                              <p className="tokenEmpty">No API tokens yet.</p>
                            )}
                          </div>
                        </section>
                        <div className="menuDivider" />
                      </>
                    ) : (
                      <>
                        <form className="authForm" onSubmit={(e) => e.preventDefault()}>
                          <label>
                            <span>Email</span>
                            <input
                              className="authInput"
                              type="email"
                              name="email"
                              value={authEmail}
                              onChange={(e) => setAuthEmail(e.target.value)}
                              autoComplete="email"
                            />
                          </label>
                          <label>
                            <span>Password</span>
                            <input
                              className="authInput"
                              type="password"
                              name="password"
                              value={authPassword}
                              onChange={(e) => setAuthPassword(e.target.value)}
                              autoComplete="current-password"
                            />
                          </label>
                          {authError && <p className="authError">{authError}</p>}
                          <div className="authActions">
                            <button type="button" className="menuItem" onClick={() => void submitAuth("login")}>
                              Sign in
                            </button>
                            <button type="button" className="menuItem accent" onClick={() => void submitAuth("register")}>
                              Create account
                            </button>
                          </div>
                        </form>
                        <div className="menuDivider" />
                      </>
                    )}
                    <div className="menuRow">
                      <span className="menuRowLabel">
                        Dark mode
                        {!canDark && <span className="proPill">Pro</span>}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={darkActive}
                        aria-label="Dark mode"
                        className={`switch ${darkActive ? "on" : ""}`}
                        disabled={!canDark}
                        onClick={toggleDarkMode}
                      >
                        <span className="switchKnob" />
                      </button>
                    </div>
                    {plan === "free" ? (
                      <button type="button" className="menuItem accent" role="menuitem" onClick={() => setPlan("pro")}>
                        Go Pro
                      </button>
                    ) : (
                      <button type="button" className="menuItem" role="menuitem" onClick={() => setPlan("free")}>
                        Switch to Free
                      </button>
                    )}
                    <p className="menuHint">
                      {plan === "free"
                        ? "Dark mode is a Pro feature."
                        : "Pro unlocked. Billing is a local preview for now."}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

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
            <MarkdownView source={active.body} theme={darkActive ? "dark" : "light"} />
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
