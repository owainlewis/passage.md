import { parseTags, snippetOf } from "./doc-utils";
import { editorDocSearchText, editorDocTags, editorDocTitle } from "./editor-list";
import { Doc } from "./editor-model";

export type WorkspaceCollection = {
  id?: string;
  slug: string;
  title: string;
  description: string;
};

export type WorkspaceView =
  | { type: "home" }
  | { type: "starred" }
  | { type: "recent" }
  | { type: "templates" }
  | { type: "collections"; createRequest?: number }
  | { type: "collection"; slug: string }
  | { type: "document" };

export const WORKSPACE_COLLECTIONS: WorkspaceCollection[] = [
  {
    slug: "documents",
    title: "Documents",
    description: "General Markdown that has not been assigned to another collection."
  }
];

export function collectionForDoc(doc: Doc, assignments: Record<string, string>, deletedCollections: string[] = []) {
  const assigned = assignments[doc.id] ?? doc.collectionSlug ?? "documents";
  if (assigned && !deletedCollections.includes(assigned)) return assigned;
  return "documents";
}

export function docsInCollection(docs: Doc[], slug: string, assignments: Record<string, string>, deletedCollections: string[] = []) {
  return docs.filter((doc) => collectionForDoc(doc, assignments, deletedCollections) === slug);
}

export function recentDocs(docs: Doc[]) {
  return docs
    .map((doc, index) => ({ doc, index, updated: doc.updatedAt ? Date.parse(doc.updatedAt) : 0 }))
    .sort((a, b) => b.updated - a.updated || a.index - b.index)
    .map(({ doc }) => doc);
}

export function searchWorkspaceDocs(
  docs: Doc[],
  query: string,
  scope: string,
  assignments: Record<string, string>,
  deletedCollections: string[] = []
) {
  const normalized = query.trim().toLowerCase();
  return recentDocs(docs).filter((doc) => {
    if (scope !== "all" && collectionForDoc(doc, assignments, deletedCollections) !== scope) return false;
    if (!normalized) return true;
    return [editorDocTitle(doc), editorDocSearchText(doc), ...editorDocTags(doc)]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
}

export function workspaceDocSummary(doc: Doc) {
  if (!doc.bodyLoaded && doc.excerpt) {
    const excerpt = doc.excerpt.trim();
    if (excerpt.startsWith("---") || /^#{1,6}\s/.test(excerpt)) return snippetOf(excerpt);
    const title = doc.title?.trim();
    if (title && excerpt.startsWith(title)) {
      const withoutTitle = excerpt.slice(title.length).trim();
      return withoutTitle || "No additional text";
    }
    return excerpt;
  }
  return snippetOf(doc.body);
}

export function workspaceDocTags(doc: Doc) {
  return doc.bodyLoaded ? parseTags(doc.body) : (doc.tags ?? []);
}

export function collectionLabel(slug: string, collections: WorkspaceCollection[] = WORKSPACE_COLLECTIONS) {
  return collections.find((collection) => collection.slug === slug)?.title ?? "Documents";
}
