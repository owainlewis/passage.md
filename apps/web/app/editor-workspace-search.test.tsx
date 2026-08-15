import { act, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceSearch } from "./editor-workspace";

const collections = [
  { id: "22222222-2222-2222-2222-222222222222", slug: "research", title: "Research", description: "Research notes." },
  { slug: "documents", title: "Documents", description: "Unfiled documents." }
];

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderSearch(query: string, scope = "all") {
  return render(
    <WorkspaceSearch
      assignments={{}}
      collections={collections}
      deletedCollections={[]}
      docs={[{ id: "recent", body: "# Recent note\n\nLocal summary.", bodyLoaded: true }]}
      query={query}
      scope={scope}
      trigger={null}
      userId="user-1"
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
      onQueryChange={vi.fn()}
      onScopeChange={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps blank search local and shows loading then empty server results", async () => {
  const pending = deferredResponse();
  const fetchMock = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetchMock);
  const view = renderSearch("");

  expect(screen.getByRole("button", { name: /Recent note/ })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <WorkspaceSearch
      assignments={{}}
      collections={collections}
      deletedCollections={[]}
      docs={[{ id: "recent", body: "# Recent note\n\nLocal summary.", bodyLoaded: true }]}
      query="needle"
      scope="all"
      trigger={null}
      userId="user-1"
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
      onQueryChange={vi.fn()}
      onScopeChange={vi.fn()}
    />
  );
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  expect(screen.queryByRole("button", { name: /Recent note/ })).not.toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("No matching documents")).toBeInTheDocument();
});

it("shows a retryable error and renders an untrusted snippet only as text", async () => {
  const snippet = '<img src=x onerror="window.pwned=true">';
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "search service unavailable" }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      documents: [{ id: "result", title: "Unsafe snippet", matchExcerpt: snippet }]
    }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const view = renderSearch("unsafe", "documents");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByRole("alert")).toHaveTextContent("search service unavailable");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/docs/search?q=unsafe&limit=50&unfiled=true");

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: /Unsafe snippet/ })).toHaveTextContent(snippet);
  expect(view.container.querySelector(".workspaceSearchResults img")).toBeNull();
});
