export type Theme = "light" | "dark";

export type Doc = {
  id: string;
  publicId?: string;
  body: string;
  bodyLoaded?: boolean;
  title?: string;
  excerpt?: string;
  tags?: string[];
  pinned?: boolean;
  starred?: boolean;
  collectionId?: string | null;
  collectionSlug?: string | null;
  shareToken?: string | null;
  sharedAt?: string | null;
  updatedAt?: string;
};

export type Mode = "edit" | "preview";
export type ShareState = "idle" | "copied" | "toolong" | "unshared" | "error";
export type SaveState = "loading" | "saving" | "saved" | "error";
export type DocumentFilter = "all" | "private" | "shared";

export const ALL_DOCUMENTS: DocumentFilter = "all";
export const SHARED_DOCUMENTS: DocumentFilter = "shared";

export function isShared(doc: Doc) {
  return Boolean(doc.sharedAt || doc.shareToken);
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

export function seedDocs(): Doc[] {
  return [{ id: "welcome", body: welcomeBody, bodyLoaded: true, pinned: true }];
}

export function publicIdFromPath() {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/^\/write\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}
