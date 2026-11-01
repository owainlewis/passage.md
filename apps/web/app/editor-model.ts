export type Theme = "light" | "dark";

export type Doc = {
  id: string;
  publicId?: string;
  body: string;
  bodyLoaded?: boolean;
  title?: string;
  excerpt?: string;
  shareToken?: string | null;
  sharedAt?: string | null;
  updatedAt?: string;
  /** Server content version this body was loaded at. Sent back on save. */
  version?: number;
};

export type ShareState = "idle" | "copied" | "toolong" | "unshared" | "error";
export type SaveState = "loading" | "saving" | "saved" | "error";
export function isShared(doc: Doc) {
  return Boolean(doc.sharedAt || doc.shareToken);
}

// Nothing written yet: no text, or only an empty heading left behind.
export function isBlankDoc(doc: Doc) {
  return doc.bodyLoaded !== false && doc.body.replace(/^#{1,6}[ \t]*$/gm, "").trim() === "";
}

export function saveLabel(state: SaveState) {
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

export function newestTimestamp(current?: string, saved?: string) {
  if (!saved) return current;
  if (!current) return saved;
  return Date.parse(saved) > Date.parse(current) ? saved : current;
}

const welcomeBody = `# Welcome to Passage

This is a quiet place to write. Everything you type is saved as Markdown.

## Writing

Type \`#\` and a space for a heading, \`-\` for a list, or \`>\` for a quote. Type \`/\` on an empty line for the block menu.

Press **⌘/** (or **Ctrl+/**) to see the raw Markdown, and again to go back.

## Finding things

Every document is in one list, newest first. Press **⌘K** to search every word you have written, or **⌘.** to show and hide the list.

## When you are ready

The **…** menu copies or downloads the Markdown and shares a read-only link you can turn off later.

> The best writing tool is the one you forget is there.
`;

export function seedDocs(): Doc[] {
  return [{ id: "welcome", body: welcomeBody, bodyLoaded: true }];
}

export function publicIdFromPath() {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/^\/write\/([^/]+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
