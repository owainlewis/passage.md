import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CLIPage from "./cli/page";
import Landing from "./page";
import { decodeDoc } from "./share";
import Write from "./write/page";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Landing", () => {
  it("renders the hero and a call to action", () => {
    render(<Landing />);

    expect(screen.getByText("Markdown writing without messy local files")).toBeInTheDocument();
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
  it("renders the writing shell in preview with a local save state", () => {
    render(<Write />);

    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    expect(screen.getByText("Saved locally")).toBeInTheDocument();
  });

  it("seeds a starter document titled from its first heading", () => {
    render(<Write />);

    expect(screen.getAllByText("Markdown for agents and humans").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Documents")).toBeInTheDocument();
  });

  it("switches to edit mode to reveal the Markdown textarea", () => {
    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("starts with the sidebar collapsed on mobile viewports", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true })
    });

    render(<Write />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument());
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia
    });
  });

  it("creates a document, updates its title, and renders Markdown preview", () => {
    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nThis is **ready**." }
    });

    expect(screen.getByRole("heading", { name: "Launch note", level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "This is ready.")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("filters the document list by title and body text", () => {
    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nRoadmap coverage." }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents" }), {
      target: { value: "roadmap" }
    });

    expect(screen.getByRole("button", { name: /Launch note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Markdown for agents and humans/ })).not.toBeInTheDocument();
  });

  it("keeps document row actions as native keyboard-reachable buttons", () => {
    render(<Write />);

    const pin = screen.getByRole("button", { name: "Unpin document" });
    expect(pin.tagName).toBe("BUTTON");

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    const remove = screen.getByRole("button", { name: "Delete document" });
    expect(remove.tagName).toBe("BUTTON");
  });

  it("still renders when browser storage reads are blocked", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    render(<Write />);

    await waitFor(() => expect(screen.getByText("Saved locally")).toBeInTheDocument());
    getItem.mockRestore();
  });

  it("copies a decodable share link for the active document", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Shared draft\n\nReadable by link." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copiedUrl = writeText.mock.calls[0][0] as string;
    expect(copiedUrl).toMatch(/^http:\/\/localhost(?::\d+)?\/d#/);
    await expect(decodeDoc(copiedUrl.split("#")[1])).resolves.toBe("# Shared draft\n\nReadable by link.");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("refuses to share a document too large to fit in a link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(<Write />);

    // Random text barely compresses, so a large body overflows the link guard.
    const huge = Array.from({ length: 30000 }, () => Math.random().toString(36)[2] ?? "x").join("");
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: huge }
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByRole("button", { name: "Too long" })).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("keeps dark mode disabled until the local Pro preview is enabled", async () => {
    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const darkMode = screen.getByRole("switch", { name: "Dark mode" });
    expect(darkMode).toBeDisabled();

    fireEvent.click(screen.getByRole("menuitem", { name: "Go Pro" }));
    expect(darkMode).not.toBeDisabled();

    fireEvent.click(darkMode);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("creates an account from the account menu and shows the signed-in user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }), {
          status: 201
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "writer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("writer@example.com")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/register",
      expect.objectContaining({ method: "POST", credentials: "include" })
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("writer@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Private server draft")).not.toBeInTheDocument());
    expect(localStorage.getItem("passage.documents.v2")).not.toContain("Private server draft");
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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

    const account = screen.getByRole("button", { name: "Account" });
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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

    const account = screen.getByRole("button", { name: "Account" });
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

  it("does not show stale token metadata after sign-out and sign-in", async () => {
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
      if (url === "/api/v1/auth/login") {
        user = { id: "user-2", email: "two@example.com" };
        return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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

    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "two@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("two@example.com")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByText("Laptop")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/api-tokens/token-1", {
      method: "DELETE",
      credentials: "include"
    });
  });

  it("does not show token management to signed-out users", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));

    expect(await screen.findByRole("button", { name: "Create account" })).toBeInTheDocument();
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
