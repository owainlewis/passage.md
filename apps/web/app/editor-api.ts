import { Doc } from "./editor-model";

export type DocumentPage = {
  documents: Doc[];
  nextCursor: string;
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
    ? body.documents.map((doc: Doc) => ({
        ...doc,
        body: typeof doc.body === "string" ? doc.body : "",
        bodyLoaded: typeof doc.body === "string"
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
  return { ...(body as Doc), bodyLoaded: true };
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
  return { ...(payload as Doc), bodyLoaded: true };
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
  return { ...(payload as Doc), bodyLoaded: true };
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
