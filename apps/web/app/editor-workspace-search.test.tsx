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

it("keeps nonblank search local when there is no authenticated user", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <WorkspaceSearch
      assignments={{}}
      collections={collections}
      deletedCollections={[]}
      docs={[
        { id: "match", body: "# Matching note\n\nA local needle.", bodyLoaded: true },
        { id: "miss", body: "# Other note\n\nNo match.", bodyLoaded: true }
      ]}
      query="needle"
      scope="all"
      trigger={null}
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
      onQueryChange={vi.fn()}
      onScopeChange={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: /Matching note/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Other note/ })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("waits for a pending save before applying PostgreSQL query semantics", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    documents: [{ id: "pending", title: "Current draft", matchExcerpt: "agent workflow without retired" }]
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const baseProps = {
    assignments: {},
    collections,
    deletedCollections: [],
    query: '"agent workflow" -retired',
    scope: "all",
    trigger: null,
    userId: "user-1",
    onClose: vi.fn(),
    onOpenDocument: vi.fn(),
    onQueryChange: vi.fn(),
    onScopeChange: vi.fn()
  };
  const view = render(
    <WorkspaceSearch
      {...baseProps}
      docs={[{ id: "pending", body: "# Current draft\n\nAn agent workflow draft.", bodyLoaded: true }]}
      searchPaused
    />
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByRole("status")).toHaveTextContent("Saving before search…");
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <WorkspaceSearch
      {...baseProps}
      docs={[{ id: "pending", body: "# Current draft\n\nAn agent workflow draft.", bodyLoaded: true }]}
    />
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/docs/search?q=%22agent+workflow%22+-retired&limit=50",
    expect.objectContaining({ credentials: "include" })
  );
  expect(screen.getByRole("button", { name: /Current draft/ })).toBeInTheDocument();
});

it("shows and retries a failed save before searching", () => {
  const retry = vi.fn();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <WorkspaceSearch
      assignments={{}}
      collections={collections}
      deletedCollections={[]}
      docs={[{ id: "pending", body: "# Pending", bodyLoaded: true }]}
      query="pending"
      scope="all"
      trigger={null}
      userId="user-1"
      searchPaused
      searchPauseError
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
      onQueryChange={vi.fn()}
      onRetryPendingSave={retry}
      onScopeChange={vi.fn()}
    />
  );

  expect(screen.getByRole("alert")).toHaveTextContent("latest draft could not be saved");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
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
