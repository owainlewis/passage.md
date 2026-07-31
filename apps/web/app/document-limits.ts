export function formatDocumentCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function isNearDocumentLimit(savedDocs: number, maxSavedDocs: number) {
  return maxSavedDocs > 0 && savedDocs >= Math.ceil(maxSavedDocs * 0.9);
}
