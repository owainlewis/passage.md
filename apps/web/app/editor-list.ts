import { bodyWithoutFrontmatter, parseTags, titleOf } from "./doc-utils";
import { ALL_DOCUMENTS, Doc, DocumentFilter, isShared, SHARED_DOCUMENTS } from "./editor-model";

type IndexedDoc = {
  doc: Doc;
  index: number;
};

export function docMatchesFilter(doc: Doc, documentFilter: DocumentFilter) {
  if (documentFilter === ALL_DOCUMENTS) return true;
  if (documentFilter === SHARED_DOCUMENTS) return isShared(doc);
  return !isShared(doc);
}

export function editorDocTitle(doc: Doc) {
  return doc.bodyLoaded ? titleOf(doc.body) : (doc.title || titleOf(doc.excerpt ?? ""));
}

export function editorDocTags(doc: Doc) {
  return doc.bodyLoaded ? parseTags(doc.body) : (doc.tags ?? []);
}

export function editorDocSearchText(doc: Doc) {
  return bodyWithoutFrontmatter(doc.bodyLoaded ? doc.body : (doc.excerpt ?? ""));
}

export function compareDocsBySidebarOrder(a: IndexedDoc, b: IndexedDoc) {
  const pinned = Number(Boolean(b.doc.pinned)) - Number(Boolean(a.doc.pinned));
  if (pinned) return pinned;
  const aUpdated = a.doc.updatedAt ? Date.parse(a.doc.updatedAt) : 0;
  const bUpdated = b.doc.updatedAt ? Date.parse(b.doc.updatedAt) : 0;
  if (aUpdated || bUpdated) return bUpdated - aUpdated;
  return a.index - b.index;
}

export function visibleEditorDocs(
  docs: Doc[],
  docsReady: boolean,
  documentFilter: DocumentFilter,
  filter: string,
  tagFilter: string
) {
  const tagFilterQuery = tagFilter.trim().toLowerCase();
  const query = filter.trim().toLowerCase();
  return (docsReady ? docs.map((doc, index) => ({ doc, index })) : [])
    .filter(({ doc }) => {
      const tags = editorDocTags(doc);
      if (!docMatchesFilter(doc, documentFilter)) return false;
      if (tagFilterQuery && !tags.some((tag) => tag.includes(tagFilterQuery))) return false;
      if (!query) return true;
      return (
        editorDocTitle(doc).toLowerCase().includes(query) ||
        editorDocSearchText(doc).toLowerCase().includes(query) ||
        tags.some((tag) => tag.includes(query))
      );
    })
    .sort(compareDocsBySidebarOrder)
    .map(({ doc }) => doc);
}

export function firstDocInFilter(docs: Doc[], documentFilter: DocumentFilter) {
  return docs
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => docMatchesFilter(doc, documentFilter))
    .sort(compareDocsBySidebarOrder)[0]?.doc;
}
