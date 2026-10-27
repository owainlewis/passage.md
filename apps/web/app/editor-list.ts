import { bodyWithoutFrontmatter, titleOf } from "./doc-utils";
import { ALL_DOCUMENTS, Doc, DocumentFilter, isShared, SHARED_DOCUMENTS } from "./editor-model";

export function docMatchesFilter(doc: Doc, documentFilter: DocumentFilter) {
  if (documentFilter === ALL_DOCUMENTS) return true;
  if (documentFilter === SHARED_DOCUMENTS) return isShared(doc);
  return !isShared(doc);
}

export function editorDocTitle(doc: Doc) {
  return doc.bodyLoaded ? titleOf(doc.body) : (doc.title || titleOf(doc.excerpt ?? ""));
}

export function editorDocSearchText(doc: Doc) {
  return bodyWithoutFrontmatter(doc.bodyLoaded ? doc.body : (doc.excerpt ?? ""));
}
