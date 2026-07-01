import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CLIPage from "./cli/page";
import Login from "./login/page";
import Landing from "./page";
import Write from "./write/page";

const defaultDocBody = "# Markdown for agents and humans\n\nWelcome to passage.";

type TestDoc = {
  id: string;
  publicId?: string;
  body: string;
  pinned?: boolean;
  shareToken?: string | null;
  sharedAt?: string | null;
};

function stubSignedInFetch(initialDocs: TestDoc[] = [{ id: "doc-welcome", body: defaultDocBody, pinned: true }]) {
  let docs: Array<TestDoc & { publicId: string }> = initialDocs.map((doc, index) => ({
    publicId: `public-${index + 1}`,
    ...doc
  }));
  let nextDoc = docs.length + 1;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/v1/me") {
      return new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
        { status: 200 }
      );
    }
    if (url === "/api/v1/docs" && method === "GET") {
      return new Response(JSON.stringify({ documents: docs }), { status: 200 });
    }
    if (url === "/api/v1/docs" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")).body ?? "";
      const doc: TestDoc & { publicId: string } = { id: `doc-${nextDoc}`, publicId: `public-${nextDoc}`, body };
      nextDoc += 1;
      docs = [doc, ...docs];
      return new Response(JSON.stringify(doc), { status: 201 });
    }
    if (url.startsWith("/api/v1/docs/") && method === "PATCH") {
      const id = url.split("/")[4];
      const body = JSON.parse(String(init?.body ?? "{}")).body ?? "";
      const doc = docs.find((existing) => existing.id === id) ?? { id, publicId: "public-updated" };
      const updated = { ...doc, body };
      docs = docs.map((existing) => (existing.id === id ? updated : existing));
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    if (url.startsWith("/api/v1/docs/") && method === "DELETE") {
      const id = url.split("/")[4];
      docs = docs.filter((doc) => doc.id !== id);
      return new Response(null, { status: 204 });
    }
    if (url.startsWith("/api/v1/docs/") && url.endsWith("/share") && method === "POST") {
      const id = url.split("/")[4];
      const doc = docs.find((existing) => existing.id === id);
      const publicId = doc?.publicId ?? "share-token";
      return new Response(
        JSON.stringify({ token: publicId, publicId, htmlPath: `/d/${publicId}`, markdownPath: `/d/${publicId}.md` }),
        { status: 200 }
      );
    }
    if (url === "/api/v1/api-tokens" && method === "GET") {
      return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
    }
    if (url === "/api/v1/auth/logout") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderWrite() {
  render(<Write />);
  await screen.findByRole("region", { name: "Markdown editor" });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeTransitionBlocked;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  stubSignedInFetch();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Landing", () => {
  it("renders the hero and a call to action", () => {
    render(<Landing />);

    expect(screen.getByText("Markdown writing for humans and agents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CLI" })).toHaveAttribute("href", "/cli");
    expect(screen.getAllByRole("link", { name: "Start writing" }).length).toBeGreaterThan(0);
  });
});

describe("CLI page", () => {
  it("explains install, auth, core commands, and releases", () => {
    render(<CLIPage />);

    expect(screen.getByRole("heading", { name: "Hosted Markdown from your terminal." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download releases" })).toHaveAttribute(
      "href",
      "https://github.com/owainlewis/passage-cli/releases"
    );
    expect(screen.getByText("passage login")).toBeInTheDocument();
    expect(screen.getByText("passage auth status --check")).toBeInTheDocument();
    expect(screen.getByText("passage replace <doc-id> ./draft.md")).toBeInTheDocument();
    expect(screen.getByText(/Copy the token when it appears/)).toBeInTheDocument();
    expect(screen.getByText(/Revoke old tokens/)).toBeInTheDocument();
    expect(screen.getByText(/raw `.md` URLs/)).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("/d/<share-token>.md"))).toBeInTheDocument();
    expect(screen.getByText(/Unshare revokes both URLs/)).toBeInTheDocument();
  });
});

describe("Write (editor)", () => {
  it("renders the writing shell in preview with a server save state", async () => {
    await renderWrite();

    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("seeds a starter document titled from its first heading", async () => {
    await renderWrite();

    expect(screen.getAllByText("Markdown for agents and humans").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Documents")).toBeInTheDocument();
  });

  it("switches to edit mode to reveal the Markdown textarea", async () => {
    await renderWrite();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("starts with the sidebar collapsed on mobile viewports", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true })
    });

    await renderWrite();

    await waitFor(() => expect(screen.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument());
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia
    });
  });

  it("creates a document, updates its title, and renders Markdown preview", async () => {
    await renderWrite();

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nThis is **ready**." }
    });

    expect(screen.getByRole("heading", { name: "Launch note", level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "This is ready.")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("filters the document list by title and body text", async () => {
    await renderWrite();

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nRoadmap coverage." }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents" }), {
      target: { value: "roadmap" }
    });

    expect(screen.getByRole("button", { name: /Launch note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Markdown for agents and humans/ })).not.toBeInTheDocument();
  });

  it("uses stable public ids in the editor URL", async () => {
    stubSignedInFetch([
      { id: "doc-notes", publicId: "notes-public-id", body: "# Agent notes\n\nFollow ups." },
      { id: "doc-scripts", publicId: "scripts-public-id", body: "# Video script\n\nOpening line." }
    ]);
    window.history.replaceState(null, "", "/write/scripts-public-id");

    await renderWrite();

    expect((await screen.findAllByRole("heading", { name: "Video script", level: 1 })).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/write/scripts-public-id");

    fireEvent.click(screen.getByRole("button", { name: /Agent notes/ }));

    expect(screen.getAllByRole("heading", { name: "Agent notes", level: 1 }).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/write/notes-public-id");
  });

  it("filters the document list by frontmatter tags", async () => {
    stubSignedInFetch([
      { id: "doc-notes", body: "---\ntags: [notes]\n---\n\n# Agent notes\n\nFollow ups." },
      { id: "doc-scripts", body: "---\ntags: [scripts]\n---\n\n# Video script\n\nOpening line." }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Agent notes/ });

    fireEvent.click(screen.getByRole("button", { name: "scripts" }));

    expect(screen.getByRole("button", { name: /Video script/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agent notes/ })).not.toBeInTheDocument();
  });

  it("saves lowercase document tags and rejects invalid tags", async () => {
    await renderWrite();
    await screen.findByText("Saved");

    const tags = screen.getByRole("textbox", { name: "Document tags" });
    fireEvent.change(tags, { target: { value: "notes, scripts" } });
    fireEvent.blur(tags);

    expect(await screen.findByRole("button", { name: "notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scripts" })).toBeInTheDocument();

    fireEvent.change(tags, { target: { value: "Notes, scripts" } });
    fireEvent.blur(tags);

    expect(await screen.findByText("Use lowercase a-z and hyphen only.")).toBeInTheDocument();
  });

  it("keeps document row actions as native keyboard-reachable buttons", async () => {
    await renderWrite();

    const pin = screen.getByRole("button", { name: "Unpin document" });
    expect(pin.tagName).toBe("BUTTON");

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });
    const remove = await screen.findByRole("button", { name: "Delete document" });
    expect(remove.tagName).toBe("BUTTON");
  });

  it("still renders when browser storage reads are blocked", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    await renderWrite();

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    getItem.mockRestore();
  });

  it("copies a server share link for the active document", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Shared draft\n\nReadable by link." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copiedUrl = writeText.mock.calls[0][0] as string;
    expect(copiedUrl).toBe("http://localhost:3000/d/public-2");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shares large documents through the server", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();

    // Random text barely compresses, so a large body overflows the link guard.
    const huge = Array.from({ length: 30000 }, () => Math.random().toString(36)[2] ?? "x").join("");
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: huge }
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/d/public-2"));
  });

  it("toggles dark mode from the sidebar for every user", async () => {
    await renderWrite();

    const darkMode = screen.getByRole("switch", { name: "Dark mode" });
    expect(darkMode).not.toBeDisabled();

    fireEvent.click(darkMode);
    expect(document.documentElement.dataset.themeTransitionBlocked).toBe("true");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(localStorage.getItem("passage.theme.v1")).toBe("dark");

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(screen.queryByText("Dark mode is a Pro feature.")).not.toBeInTheDocument();
  });

  it("signs in from the closed beta login page without showing sign up", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }), {
          status: 200
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<Login />);

    expect(await screen.findByText("Closed beta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "writer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/login",
        expect.objectContaining({ method: "POST", credentials: "include" })
      )
    );
  });

  it("signs out from the account menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Private server draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/auth/logout") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("writer@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Private server draft")).not.toBeInTheDocument());
    expect(localStorage.getItem("passage.documents.v2")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", { method: "POST", credentials: "include" });
  });

  it("creates and copies an API token from the account menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "psg_plaintext",
            apiToken: { id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("writer@example.com")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("psg_plaintext")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("psg_plaintext");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/api-tokens",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Laptop" })
      })
    );
  });

  it("hides API token plaintext after closing and reopening the account menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(
          JSON.stringify({ tokens: [{ id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }] }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "psg_one_time",
            apiToken: { id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    const account = await screen.findByRole("button", { name: "Account" });
    fireEvent.click(account);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("psg_one_time")).toBeInTheDocument();

    fireEvent.click(account);
    await waitFor(() => expect(screen.queryByLabelText("API tokens")).not.toBeInTheDocument());
    fireEvent.click(account);

    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.queryByText("psg_one_time")).not.toBeInTheDocument();
  });

  it("keeps token creation disabled when list loading finishes during create", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    let resolveList: ((response: Response) => void) | undefined;
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("button", { name: "Creating" })).toBeDisabled();

    resolveList?.(new Response(JSON.stringify({ tokens: [] }), { status: 200 }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Creating" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Create token" })).not.toBeInTheDocument();

    resolveCreate?.(
      new Response(
        JSON.stringify({
          token: "psg_pending_create",
          apiToken: { id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }
        }),
        { status: 201 }
      )
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("keeps created token metadata when an older list request finishes later", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    let resolveList: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "psg_created_before_list",
            apiToken: { id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();

    resolveList?.(new Response(JSON.stringify({ tokens: [] }), { status: 200 }));

    await waitFor(() => expect(screen.getByText("Laptop")).toBeInTheDocument());
    expect(screen.queryByText("No API tokens yet.")).not.toBeInTheDocument();
  });

  it("hides API token plaintext and lists metadata if the account menu reopens before creation finishes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    let createdListed = false;
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(
          JSON.stringify({
            tokens: createdListed ? [{ id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }] : []
          }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveCreate = (response) => {
            createdListed = true;
            resolve(response);
          };
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    const account = await screen.findByRole("button", { name: "Account" });
    fireEvent.click(account);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("button", { name: "Creating" })).toBeInTheDocument();
    fireEvent.click(account);
    fireEvent.click(account);

    resolveCreate?.(
      new Response(
        JSON.stringify({
          token: "psg_delayed_secret",
          apiToken: { id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }
        }),
        { status: 201 }
      )
    );

    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.queryByText("psg_delayed_secret")).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalledWith("psg_delayed_secret");
  });

  it("clears stale token metadata after sign-out", async () => {
    let user: { id: string; email: string } | null = { id: "user-1", email: "one@example.com" };
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(JSON.stringify(user ? { authenticated: true, user } : { authenticated: false }), {
          status: 200
        });
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      }
      if (url === "/api/v1/auth/logout") {
        user = null;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Old laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("button", { name: "Creating" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    resolveCreate?.(
      new Response(
        JSON.stringify({
          token: "psg_old_user_secret",
          apiToken: { id: "token-1", name: "Old laptop", createdAt: "2026-06-28T12:00:00Z" }
        }),
        { status: 201 }
      )
    );

    expect(await screen.findByText("Redirecting to sign in")).toBeInTheDocument();
    expect(screen.queryByText("Old laptop")).not.toBeInTheDocument();
    expect(screen.queryByText("psg_old_user_secret")).not.toBeInTheDocument();
  });

  it("does not show API token plaintext after refresh", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const firstFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      if (url === "/api/v1/api-tokens" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "psg_refresh_secret",
            apiToken: { id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }
          }),
          { status: 201 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", firstFetch);
    const first = render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("psg_refresh_secret")).toBeInTheDocument();
    first.unmount();

    const refreshFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(
          JSON.stringify({ tokens: [{ id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", refreshFetch);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.queryByText("psg_refresh_secret")).not.toBeInTheDocument();
  });

  it("revokes an API token from the account menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(
          JSON.stringify({ tokens: [{ id: "token-1", name: "Laptop", createdAt: "2026-06-28T12:00:00Z" }] }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens/token-1" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByText("Laptop")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/api-tokens/token-1", {
      method: "DELETE",
      credentials: "include"
    });
  });

  it("redirects signed-out users away from the editor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect(await screen.findByText("Redirecting to sign in")).toBeInTheDocument();
    expect(screen.queryByLabelText("API tokens")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/api-tokens", expect.anything());
  });

  it("loads saved documents for a signed-in user", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft\n\nServer copy." }] }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs", { credentials: "include" });
  });

  it("creates the starter document on the server when a signed-in user has none", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [] }), { status: 200 });
      }
      if (url === "/api/v1/docs" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "doc-welcome", body: JSON.parse(String(init.body)).body }), {
          status: 201
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect((await screen.findAllByText("Markdown for agents and humans")).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/docs",
        expect.objectContaining({ method: "POST", credentials: "include" })
      )
    );
  });

  it("does not import legacy local drafts to the server", async () => {
    localStorage.setItem(
      "passage.documents.v2",
      JSON.stringify([{ id: "local-1", body: "# Local draft\n\nMove me into Postgres." }])
    );
    localStorage.setItem("passage.active.v2", "local-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [] }), { status: 200 });
      }
      if (url === "/api/v1/docs" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "doc-imported", body: JSON.parse(String(init.body)).body }), {
          status: 201
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect((await screen.findAllByText("Markdown for agents and humans")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Local draft")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/docs",
        expect.objectContaining({
          method: "POST",
          credentials: "include"
        })
      )
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ body: JSON.stringify({ body: "# Local draft\n\nMove me into Postgres." }) })
    );
  });

  it("autosaves signed-in document edits to the API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/docs/doc-1" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: "doc-1", body: JSON.parse(String(init.body)).body }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Saved draft\n\nAutosaved." }
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/docs/doc-1",
        expect.objectContaining({
          method: "PATCH",
          credentials: "include",
          body: JSON.stringify({ body: "# Saved draft\n\nAutosaved." })
        })
      )
    );
  });

  it("creates a server share link for a signed-in document", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/docs/doc-1/share" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ token, htmlPath: `/d/${token}`, markdownPath: `/d/${token}.md` }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/d/${token}`));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1/share", {
      method: "POST",
      credentials: "include"
    });
    expect(await screen.findByRole("button", { name: "Unshare" })).toBeInTheDocument();
  });

  it("unshares a signed-in document", async () => {
    const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs" && !init?.method) {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft", shareToken: token }] }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs/doc-1/share" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    const unshare = await screen.findByRole("button", { name: "Unshare" });
    fireEvent.click(unshare);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Unshare" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1/share", {
      method: "DELETE",
      credentials: "include"
    });
  });
});
