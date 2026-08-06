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
      useEditorSearch({ query: props.query, visibility: "all", userId: "user-1", mutationVersion: 0 }),
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
    "/api/v1/docs/search?q=second+query&visibility=all&limit=50"
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
  expect(result.current.error).toBe(false);
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
    (props: { mutationVersion: number }) =>
      useEditorSearch({ query: "agent", visibility: "private", userId: "user-1", ...props }),
    { initialProps: { mutationVersion: 0 } }
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
    "/api/v1/docs/search?q=agent&visibility=private&limit=50&cursor=next-page"
  );
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["a", "b", "c"]);
  expect(result.current.hasMore).toBe(false);

  rerender({ mutationVersion: 1 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["a", "b", "c"]);
  expect(result.current.error).toBe(true);

  await act(async () => {
    result.current.retry();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["a"]);
  expect(result.current.documents[0].matchExcerpt).toBe("refreshed");
  expect(result.current.error).toBe(false);
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
      useEditorSearch({ query: "secret", visibility: "all", userId: props.userId, mutationVersion: 0 }),
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

it("restarts the first page when visibility changes", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(searchResponse([{ id: "all", title: "All", matchExcerpt: "all" }]))
    .mockResolvedValueOnce(searchResponse([{ id: "shared", title: "Shared", matchExcerpt: "shared" }]));
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook(
    (props: { visibility: "all" | "private" | "shared" }) =>
      useEditorSearch({ query: "notes", visibility: props.visibility, userId: "user-1", mutationVersion: 0 }),
    { initialProps: { visibility: "all" } as { visibility: "all" | "private" | "shared" } }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["all"]);

  rerender({ visibility: "shared" });
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["all"]);
  expect(result.current.loading).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  });
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/v1/docs/search?q=notes&visibility=shared&limit=50"
  );
  expect(result.current.documents.map((doc) => doc.id)).toEqual(["shared"]);
});
