import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { apiDocsPage } from "./editor-api";
import { Doc } from "./editor-model";
import { useEditorCollections } from "./use-editor-collections";

const research = {
  id: "collection-research",
  slug: "research",
  title: "Research",
  description: "Sources and findings.",
  createdAt: "2026-08-15T09:00:00Z",
  updatedAt: "2026-08-15T09:00:00Z"
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("hydrates persisted collection membership and stars from document pages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    documents: [{
      id: "doc-1",
      publicId: "public-1",
      title: "Persisted",
      excerpt: "Persisted body",
      collectionId: research.id,
      collectionSlug: research.slug,
      starred: true,
      updatedAt: "2026-08-15T10:00:00Z"
    }]
  }), { status: 200 })));

  const page = await apiDocsPage();

  expect(page.documents[0]).toMatchObject({
    collectionId: research.id,
    collectionSlug: research.slug,
    starred: true,
    pinned: true,
    bodyLoaded: false
  });
});

it("persists collection creation, rename, membership, and stars before updating confirmed state", async () => {
  let resolveMembership: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/v1/collections" && method === "GET") {
      return new Response(JSON.stringify({ collections: [research] }), { status: 200 });
    }
    if (url === "/api/v1/collections" && method === "POST") {
      return new Response(JSON.stringify({ ...research, id: "collection-notes", slug: "notes", title: "Notes" }), { status: 201 });
    }
    if (url === "/api/v1/collections/notes" && method === "PATCH") {
      return new Response(JSON.stringify({ ...research, id: "collection-notes", slug: "notes", title: "Team Notes" }), { status: 200 });
    }
    if (url === "/api/v1/docs/doc-1" && method === "PATCH") {
      const input = JSON.parse(String(init?.body ?? "{}"));
      if (Object.prototype.hasOwnProperty.call(input, "collectionId")) {
        return new Promise<Response>((resolve) => {
          resolveMembership = resolve;
        });
      }
      return new Response(JSON.stringify({
        id: "doc-1",
        publicId: "public-1",
        body: "# Stable",
        collectionId: research.id,
        collectionSlug: research.slug,
        starred: true
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useCollectionHarness([{
    id: "doc-1",
    body: "# Stable",
    bodyLoaded: true,
    collectionId: null,
    collectionSlug: null,
    starred: false,
    pinned: false
  }]));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.createCollection("Notes", "")).toMatchObject({ slug: "notes" });
  });
  await act(async () => {
    expect(await result.current.updateCollection("notes", "Team Notes", "")).toBe(true);
  });
  expect(result.current.collections.find((collection) => collection.slug === "notes")?.title).toBe("Team Notes");

  let membership: Promise<boolean>;
  act(() => {
    membership = result.current.assignCollection("doc-1", "research");
  });
  await waitFor(() => expect(result.current.pendingDocIds.has("doc-1")).toBe(true));
  expect(result.current.docs[0].collectionSlug).toBeNull();

  resolveMembership!(new Response(JSON.stringify({
    id: "doc-1",
    publicId: "public-1",
    body: "# Stable",
    collectionId: research.id,
    collectionSlug: research.slug,
    starred: false
  }), { status: 200 }));
  await act(async () => {
    expect(await membership).toBe(true);
  });
  expect(result.current.docs[0]).toMatchObject({ collectionSlug: "research", starred: false });

  await act(async () => {
    expect(await result.current.toggleStar("doc-1")).toBe(true);
  });
  expect(result.current.docs[0]).toMatchObject({ collectionSlug: "research", starred: true, pinned: true });
});

it("keeps the last confirmed document state and shows a failed metadata mutation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/v1/collections" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ collections: [research] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "metadata write failed" }), { status: 500 });
  }));
  const { result } = renderHook(() => useCollectionHarness([{
    id: "doc-1",
    body: "# Stable",
    bodyLoaded: true,
    collectionId: research.id,
    collectionSlug: research.slug,
    starred: true,
    pinned: true
  }]));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.assignCollection("doc-1", "documents")).toBe(false);
  });

  expect(result.current.docs[0]).toMatchObject({
    body: "# Stable",
    collectionId: research.id,
    collectionSlug: research.slug,
    starred: true,
    pinned: true
  });
  expect(result.current.notice).toBe("metadata write failed");
  expect(result.current.pendingDocIds.has("doc-1")).toBe(false);
});

it("keeps confirmed collections and documents after failed collection mutations", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (String(input) === "/api/v1/collections" && method === "GET") {
      return new Response(JSON.stringify({ collections: [research] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `${method.toLowerCase()} collection failed` }), { status: 500 });
  }));
  const initialDoc: Doc = {
    id: "doc-1",
    body: "# Stable",
    bodyLoaded: true,
    collectionId: research.id,
    collectionSlug: research.slug,
    starred: true,
    pinned: true
  };
  const { result } = renderHook(() => useCollectionHarness([initialDoc]));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.createCollection("Notes", "")).toBeNull();
    expect(await result.current.updateCollection("research", "Discovery", "")).toBe(false);
    expect(await result.current.deleteCollection("research")).toBe(false);
  });

  expect(result.current.collections).toEqual([expect.objectContaining({ slug: "research", title: "Research" })]);
  expect(result.current.docs).toEqual([initialDoc]);
  expect(result.current.notice).toBe("delete collection failed");
  expect(result.current.creatingCollection).toBe(false);
  expect(result.current.pendingCollectionSlugs.size).toBe(0);
});

it("moves loaded documents to Documents only after collection deletion succeeds", async () => {
  let deleteCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (String(input) === "/api/v1/collections" && method === "GET") {
      return new Response(JSON.stringify({ collections: [research] }), { status: 200 });
    }
    if (String(input) === "/api/v1/collections/research" && method === "DELETE") {
      deleteCalls += 1;
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  }));
  const { result } = renderHook(() => useCollectionHarness([{
    id: "doc-1",
    body: "# Stable",
    bodyLoaded: true,
    collectionId: research.id,
    collectionSlug: research.slug,
    starred: true,
    pinned: true
  }]));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.deleteCollection("research")).toBe(true);
  });

  expect(deleteCalls).toBe(1);
  expect(result.current.collections).toEqual([]);
  expect(result.current.docs[0]).toMatchObject({
    body: "# Stable",
    collectionId: null,
    collectionSlug: null,
    starred: true
  });
});

function useCollectionHarness(initialDocs: Doc[]) {
  const [docs, setDocs] = useState(initialDocs);
  const [notice, setNotice] = useState("");
  return {
    docs,
    notice,
    ...useEditorCollections({ userId: "user-1", docs, setDocs, setNotice })
  };
}
