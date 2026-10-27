import { Doc } from "./editor-model";

export type DocumentPage = {
  documents: Doc[];
  nextCursor: string;
};

export type SearchDocument = Doc & {
  matchExcerpt: string;
};

export type SearchDocumentPage = {
  documents: SearchDocument[];
  nextCursor: string;
};

export type SearchScope = {
  collectionId?: string;
  unfiled?: boolean;
};

export async function apiDocsPage(cursor = ""): Promise<DocumentPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const res = await fetch(`/api/v1/docs?${query}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Documents could not be loaded");
  }
  const documents = Array.isArray(body.documents)
    ? body.documents.map((doc: Doc) => normalizeDoc(doc, typeof doc.body === "string"))
    : [];
  return {
    documents,
    nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : ""
  };
}

export async function apiSearchDocs(
  value: string,
  scope: SearchScope,
  cursor = "",
  signal?: AbortSignal
): Promise<SearchDocumentPage> {
  const query = new URLSearchParams({ q: value, limit: "50" });
  if (scope.collectionId) query.set("collectionId", scope.collectionId);
  if (scope.unfiled) query.set("unfiled", "true");
  if (cursor) query.set("cursor", cursor);
  const res = await fetch(`/api/v1/docs/search?${query}`, {
    credentials: "include",
    signal
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Search unavailable");
  }
  const documents = Array.isArray(body.documents)
    ? body.documents.map((doc: SearchDocument) => ({
        ...normalizeDoc(doc, false),
        matchExcerpt: typeof doc.matchExcerpt === "string" ? doc.matchExcerpt : ""
      }))
    : [];
  return {
    documents,
    nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : ""
  };
}

export async function apiDoc(id: string): Promise<Doc> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Document could not be loaded");
  }
  return normalizeDoc(body as Doc, true);
}

export async function apiCreateDoc(body: string): Promise<Doc> {
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
  return normalizeDoc(payload as Doc, true);
}

/**
 * Raised when the stored document moved on since this editor loaded it.
 * Carries the server's copy so the caller can show both sides rather than
 * discarding the draft in hand.
 */
export class DocumentConflictError extends Error {
  readonly current: Doc;

  constructor(message: string, current: Doc) {
    super(message);
    this.name = "DocumentConflictError";
    this.current = current;
  }
}

export async function apiUpdateDoc(id: string, body: string, version?: number): Promise<Doc> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(typeof version === "number" ? { body, version } : { body })
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 409 && payload && typeof payload === "object" && payload.document) {
    throw new DocumentConflictError(
      typeof payload.error === "string" ? payload.error : "Document changed since it was loaded",
      normalizeDoc(payload.document as Doc, true)
    );
  }
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be saved");
  }
  return normalizeDoc(payload as Doc, true);
}

function normalizeDoc(doc: Doc, bodyLoaded: boolean): Doc {
  const starred = typeof doc.starred === "boolean" ? doc.starred : Boolean(doc.pinned);
  return {
    ...doc,
    body: typeof doc.body === "string" ? doc.body : "",
    bodyLoaded,
    starred,
    pinned: starred,
    collectionId: doc.collectionId ?? null,
    collectionSlug: doc.collectionSlug ?? null
  };
}

export async function apiArchiveDoc(id: string): Promise<void> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be archived");
  }
}

export type ShareResponse = {
  token: string;
  publicId?: string;
  htmlPath: string;
  markdownPath: string;
};

// The server answers 402 when a feature needs Passage Pro.
export class ProRequiredError extends Error {
  constructor() {
    super("Passage Pro is required");
    this.name = "ProRequiredError";
  }
}

export async function apiShareDoc(id: string): Promise<ShareResponse> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}/share`, {
    method: "POST",
    credentials: "include"
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 402) throw new ProRequiredError();
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be shared");
  }
  return payload as ShareResponse;
}

export async function apiUnshareDoc(id: string): Promise<void> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}/share`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Document could not be unshared");
  }
}
