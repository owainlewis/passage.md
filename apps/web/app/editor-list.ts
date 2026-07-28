import { bodyWithoutFrontmatter, parseTags, titleOf } from "./doc-utils";
import { Doc, isShared, PRIVATE_FOLDER, SHARED_FOLDER } from "./editor-model";

type IndexedDoc = {
  doc: Doc;
  index: number;
};

export function docMatchesFolder(doc: Doc, folderId: string) {
  if (folderId === SHARED_FOLDER) return isShared(doc);
  return !isShared(doc);
}

export function compareDocsBySidebarOrder(a: IndexedDoc, b: IndexedDoc) {
  const pinned = Number(Boolean(b.doc.pinned)) - Number(Boolean(a.doc.pinned));
  if (pinned) return pinned;
  const aUpdated = a.doc.updatedAt ? Date.parse(a.doc.updatedAt) : 0;
  const bUpdated = b.doc.updatedAt ? Date.parse(b.doc.updatedAt) : 0;
  if (aUpdated || bUpdated) return bUpdated - aUpdated;
  return a.index - b.index;
}

export function editorFolderRows(docs: Doc[], docsReady: boolean) {
  return [
    { id: PRIVATE_FOLDER, label: "Private", count: docsReady ? docs.filter((doc) => !isShared(doc)).length : 0 },
    { id: SHARED_FOLDER, label: "Shared", count: docsReady ? docs.filter(isShared).length : 0 }
  ];
}

export function visibleEditorDocs(
  docs: Doc[],
  docsReady: boolean,
  selectedFolder: string,
  filter: string,
  tagFilter: string
) {
  const tagFilterQuery = tagFilter.trim().toLowerCase();
  const query = filter.trim().toLowerCase();
  return (docsReady ? docs.map((doc, index) => ({ doc, index })) : [])
    .filter(({ doc }) => {
      const tags = parseTags(doc.body);
      if (!docMatchesFolder(doc, selectedFolder)) return false;
      if (tagFilterQuery && !tags.some((tag) => tag.includes(tagFilterQuery))) return false;
      if (!query) return true;
      return (
        titleOf(doc.body).toLowerCase().includes(query) ||
        bodyWithoutFrontmatter(doc.body).toLowerCase().includes(query) ||
        tags.some((tag) => tag.includes(query))
      );
    })
    .sort(compareDocsBySidebarOrder)
    .map(({ doc }) => doc);
}

export function firstDocInFolder(docs: Doc[], folderId: string) {
  return docs
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => docMatchesFolder(doc, folderId))
    .sort(compareDocsBySidebarOrder)[0]?.doc;
}
