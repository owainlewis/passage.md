import { act, renderHook } from "@testing-library/react";
import { useEditorSearch } from "./use-editor-search";

function searchResponse(
  documents: Array<{ id: string; title: string; matchExcerpt: string }>,
  nextCursor = ""
) {
  return new Response(JSON.stringify({ documents, nextCursor }), { status: 200 });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("debounces queries, aborts superseded work, and ignores a late response", async () => {
  const first = deferredResponse();
  const second = deferredResponse();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook(
    (props: { query: string }) =>
      useEditorSearch({ query: props.query, scope: {}, userId: "user-1" }),
    { initialProps: { query: "" } }
  );

  rerender({ query: "first query" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  rerender({ query: "second   query" });
  expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toHaveProperty("aborted", true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/v1/docs/search?q=second+query&limit=50"
  );

  await act(async () => {
    second.resolve(searchResponse([{ id: "second", title: "Second", matchExcerpt: "new result" }]));
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["second"]);

  await act(async () => {
    first.resolve(searchResponse([{ id: "first", title: "First", matchExcerpt: "stale result" }]));
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["second"]);
  expect(result.current.errorMessage).toBe("");
});

it("maps collection and Documents scopes to the authenticated search API", async () => {
  const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = renderHook(
    (props: { collectionId?: string; unfiled?: boolean }) =>
      useEditorSearch({ query: "notes", scope: props, userId: "user-1" }),
    { initialProps: { collectionId: "22222222-2222-2222-2222-222222222222" } as { collectionId?: string; unfiled?: boolean } }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/v1/docs/search?q=notes&limit=50&collectionId=22222222-2222-2222-2222-222222222222"
  );

  rerender({ unfiled: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/v1/docs/search?q=notes&limit=50&unfiled=true"
  );
});

it("refreshes an unchanged query after a pending save completes", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(searchResponse([]))
    .mockResolvedValueOnce(searchResponse([{ id: "saved", title: "Saved", matchExcerpt: "fresh needle" }]));
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(
    (props: { refreshKey: string }) =>
      useEditorSearch({ query: "needle", scope: {}, userId: "user-1", refreshKey: props.refreshKey }),
    { initialProps: { refreshKey: "pending:doc-1" } }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents).toEqual([]);

  rerender({ refreshKey: "" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["saved"]);
});

it("paginates without duplicates and preserves results through failure and retry", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      searchResponse(
        [
          { id: "a", title: "A", matchExcerpt: "first" },
          { id: "b", title: "B", matchExcerpt: "second" }
        ],
        "next-page"
      )
    )
    .mockResolvedValueOnce(
      searchResponse([
        { id: "b", title: "B", matchExcerpt: "duplicate" },
        { id: "c", title: "C", matchExcerpt: "third" }
      ])
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }))
    .mockResolvedValueOnce(searchResponse([{ id: "a", title: "A", matchExcerpt: "refreshed" }]));
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook(
    (props: { query: string }) =>
      useEditorSearch({ query: props.query, scope: { unfiled: true }, userId: "user-1" }),
    { initialProps: { query: "agent" } }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["a", "b"]);
  expect(result.current.hasMore).toBe(true);

  await act(async () => {
    result.current.loadMore();
    await flushPromises();
  });
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/v1/docs/search?q=agent&limit=50&unfiled=true&cursor=next-page"
  );
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["a", "b", "c"]);

  rerender({ query: "agents" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents).toEqual([]);
  expect(result.current.errorMessage).toBe("rate limited");

  await act(async () => {
    result.current.retry();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["a"]);
  expect(result.current.documents[0].matchExcerpt).toBe("refreshed");
});

it("does not expose results from a previous account", async () => {
  const secondAccount = deferredResponse();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(searchResponse([{ id: "private-a", title: "A", matchExcerpt: "secret" }]))
    .mockImplementationOnce(() => secondAccount.promise);
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook(
    (props: { userId: string }) =>
      useEditorSearch({ query: "secret", scope: {}, userId: props.userId }),
    { initialProps: { userId: "user-1" } }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["private-a"]);

  rerender({ userId: "user-2" });
  expect(result.current.documents).toEqual([]);
  expect(result.current.loading).toBe(true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await act(async () => {
    secondAccount.resolve(searchResponse([]));
    await flushPromises();
  });
});

it("accepts 200 Unicode characters and rejects 201 without a request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook(
    (props: { query: string }) =>
      useEditorSearch({ query: props.query, scope: {}, userId: "user-1" }),
    { initialProps: { query: "🙂".repeat(200) } }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  rerender({ query: "🙂".repeat(201) });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(false);
  expect(result.current.documents).toEqual([]);
  expect(result.current.errorMessage).toBe("Search is limited to 200 characters.");
});
