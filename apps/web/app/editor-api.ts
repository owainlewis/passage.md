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

export type Collection = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Template = {
  id: string;
  title: string;
  description: string;
  body: string;
  createdAt: string;
  updatedAt: string;
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

export async function apiUpdateDoc(id: string, body: string): Promise<Doc> {
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
  return normalizeDoc(payload as Doc, true);
}

export async function apiUpdateDocMetadata(
  id: string,
  update: { collectionId?: string | null; starred?: boolean }
): Promise<Doc> {
  const res = await fetch(`/api/v1/docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Document metadata could not be saved");
  }
  return normalizeDoc(payload as Doc, true);
}

export async function apiCollections(): Promise<Collection[]> {
  const res = await fetch("/api/v1/collections", { credentials: "include" });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Collections could not be loaded");
  }
  return Array.isArray(payload.collections) ? payload.collections : [];
}

export async function apiCreateCollection(title: string, description: string): Promise<Collection> {
  return mutateCollection("/api/v1/collections", "POST", title, description);
}

export async function apiUpdateCollection(slug: string, title: string, description: string): Promise<Collection> {
  return mutateCollection(`/api/v1/collections/${encodeURIComponent(slug)}`, "PATCH", title, description);
}

export async function apiDeleteCollection(slug: string): Promise<void> {
  const res = await fetch(`/api/v1/collections/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Collection could not be deleted");
  }
}

async function mutateCollection(
  path: string,
  method: "POST" | "PATCH",
  title: string,
  description: string
): Promise<Collection> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description: description || null })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Collection could not be saved");
  }
  return payload as Collection;
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

export async function apiShareDoc(id: string): Promise<ShareResponse> {
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

export async function apiTemplates(): Promise<Template[]> {
  const res = await fetch("/api/v1/templates", { credentials: "include" });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Templates could not be loaded");
  }
  return Array.isArray(payload.templates) ? payload.templates : [];
}

export async function apiCreateTemplate(title: string, description: string, body: string): Promise<Template> {
  const res = await fetch("/api/v1/templates", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, body })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Template could not be created");
  }
  return payload as Template;
}

export async function apiUpdateTemplate(template: Template): Promise<Template> {
  const res = await fetch(`/api/v1/templates/${encodeURIComponent(template.id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: template.title, description: template.description, body: template.body })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Template could not be saved");
  }
  return payload as Template;
}

export async function apiDeleteTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/v1/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Template could not be deleted");
  }
}
