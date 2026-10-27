import { bodyWithoutFrontmatter, titleOf } from "./doc-utils";
import { Doc } from "./editor-model";

export function editorDocTitle(doc: Doc) {
  return doc.bodyLoaded ? titleOf(doc.body) : (doc.title || titleOf(doc.excerpt ?? ""));
}

export function editorDocSearchText(doc: Doc) {
  return bodyWithoutFrontmatter(doc.bodyLoaded ? doc.body : (doc.excerpt ?? ""));
}
