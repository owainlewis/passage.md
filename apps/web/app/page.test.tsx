import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import Account from "./account/page";
import { AppProviders } from "./app-providers";
import { AuthProvider } from "./auth";
import CLIPage from "./cli/page";
import Login from "./login/page";
import Signup from "./signup/page";
import Landing from "./page";
import Cancellation from "./cancellation/page";
import Privacy from "./privacy/page";
import Refunds from "./refunds/page";
import Terms from "./terms/page";
import Write from "./write/page";

const defaultDocBody = "# Markdown for agents and humans\n\nWelcome to passage.";
const proAccount = {
  plan: "pro",
  source: "stripe",
  limits: { maxSavedDocs: 2000 },
  usage: { savedDocs: 1 },
  subscription: { stripeCustomerId: "cus_test", status: "active", cancelAtPeriodEnd: false }
};
const manualProAccount = {
  plan: "pro",
  source: "manual",
  limits: { maxSavedDocs: 2000 },
  usage: { savedDocs: 1 },
  subscription: { status: "active", cancelAtPeriodEnd: false }
};
const communityProAccount = {
  plan: "pro",
  source: "community",
  limits: { maxSavedDocs: 2000 },
  usage: { savedDocs: 1 },
  subscription: { cancelAtPeriodEnd: false }
};
const freeAccount = {
  plan: "free",
  source: "default",
  limits: { maxSavedDocs: 1 },
  usage: { savedDocs: 1 },
  subscription: { cancelAtPeriodEnd: false }
};

type TestDoc = {
  id: string;
  publicId?: string;
  body: string;
  pinned?: boolean;
  starred?: boolean;
  collectionId?: string | null;
  collectionSlug?: string | null;
  shareToken?: string | null;
  sharedAt?: string | null;
  updatedAt?: string;
};

function stubSignedInFetch(initialDocs: TestDoc[] = [{ id: "doc-welcome", body: defaultDocBody, pinned: true }]) {
  let docs: Array<TestDoc & { publicId: string }> = initialDocs.map((doc, index) => ({
    publicId: `public-${index + 1}`,
    ...doc
  }));
  let nextDoc = docs.length + 1;
  let collections = [
    { id: "collection-context", slug: "operating-context", title: "Operating Context", description: "Stable context.", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },
    { id: "collection-content", slug: "content-studio", title: "Content Studio", description: "Content work.", createdAt: "2026-08-01T10:01:00Z", updatedAt: "2026-08-01T10:01:00Z" },
    { id: "collection-passage", slug: "passage", title: "Passage", description: "Passage work.", createdAt: "2026-08-01T10:02:00Z", updatedAt: "2026-08-01T10:02:00Z" },
    { id: "collection-research", slug: "research", title: "Research", description: "Research notes.", createdAt: "2026-08-01T10:03:00Z", updatedAt: "2026-08-01T10:03:00Z" }
  ];
  let templates: Array<{ id: string; title: string; description: string; body: string; createdAt: string; updatedAt: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/v1/me") {
      return new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
        { status: 200 }
      );
    }
    if (url.startsWith("/api/v1/docs/search?") && method === "GET") {
      const requestURL = new URL(url, "http://passage.test");
      const query = requestURL.searchParams.get("q")?.toLowerCase() ?? "";
      const collectionId = requestURL.searchParams.get("collectionId");
      const unfiled = requestURL.searchParams.get("unfiled") === "true";
      const matches = docs.filter((doc) => {
        if (collectionId && doc.collectionId !== collectionId) return false;
        if (unfiled && doc.collectionId) return false;
        return doc.body.toLowerCase().includes(query);
      }).map((doc) => {
        const title = doc.body.match(/^#\s+(.+)$/m)?.[1] ?? "Untitled";
        return {
          ...doc,
          body: undefined,
          title,
          matchExcerpt: doc.body.replace(/^---[\s\S]*?---\s*/, "").replace(/^#\s+.+$/m, "").trim()
        };
      });
      return new Response(JSON.stringify({ documents: matches }), { status: 200 });
    }
    if (url.startsWith("/api/v1/docs?") && method === "GET") {
      return new Response(JSON.stringify({ documents: docs }), { status: 200 });
    }
    if (url === "/api/v1/collections" && method === "GET") {
      return new Response(JSON.stringify({ collections }), { status: 200 });
    }
    if (url === "/api/v1/collections" && method === "POST") {
      const input = JSON.parse(String(init?.body ?? "{}"));
      const base = String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collection";
      let slug = base;
      let suffix = 2;
      while (["all", "documents"].includes(slug) || collections.some((collection) => collection.slug === slug)) slug = `${base}-${suffix++}`;
      const collection = { id: `collection-${collections.length + 1}`, slug, title: input.title, description: input.description, createdAt: "2026-08-01T11:00:00Z", updatedAt: "2026-08-01T11:00:00Z" };
      collections = [...collections, collection];
      return new Response(JSON.stringify(collection), { status: 201 });
    }
    if (url.startsWith("/api/v1/collections/") && method === "PATCH") {
      const slug = url.split("/")[4];
      const input = JSON.parse(String(init?.body ?? "{}"));
      const current = collections.find((collection) => collection.slug === slug)!;
      const updated = { ...current, title: input.title, description: input.description, updatedAt: "2026-08-01T11:01:00Z" };
      collections = collections.map((collection) => collection.slug === slug ? updated : collection);
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    if (url.startsWith("/api/v1/collections/") && method === "DELETE") {
      const slug = url.split("/")[4];
      const removed = collections.find((collection) => collection.slug === slug);
      collections = collections.filter((collection) => collection.slug !== slug);
      docs = docs.map((doc) => doc.collectionId === removed?.id ? { ...doc, collectionId: null, collectionSlug: null } : doc);
      return new Response(null, { status: 204 });
    }
    if (url === "/api/v1/templates" && method === "GET") {
      return new Response(JSON.stringify({ templates }), { status: 200 });
    }
    if (url === "/api/v1/templates" && method === "POST") {
      const input = JSON.parse(String(init?.body ?? "{}"));
      const template = {
        id: `template-${templates.length + 1}`,
        title: input.title,
        description: input.description,
        body: input.body,
        createdAt: "2026-08-04T10:00:00Z",
        updatedAt: "2026-08-04T10:00:00Z"
      };
      templates = [template, ...templates];
      return new Response(JSON.stringify(template), { status: 201 });
    }
    if (url.startsWith("/api/v1/templates/") && method === "PATCH") {
      const id = url.split("/")[4];
      const input = JSON.parse(String(init?.body ?? "{}"));
      const current = templates.find((template) => template.id === id);
      const updated = { ...current, ...input, id, updatedAt: "2026-08-04T10:01:00Z" };
      templates = templates.map((template) => (template.id === id ? updated : template));
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    if (url.startsWith("/api/v1/templates/") && method === "DELETE") {
      const id = url.split("/")[4];
      templates = templates.filter((template) => template.id !== id);
      return new Response(null, { status: 204 });
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
      const input = JSON.parse(String(init?.body ?? "{}"));
      const doc = docs.find((existing) => existing.id === id) ?? { id, publicId: "public-updated", body: "" };
      const collection = Object.prototype.hasOwnProperty.call(input, "collectionId")
        ? collections.find((candidate) => candidate.id === input.collectionId)
        : undefined;
      const updated = {
        ...doc,
        ...(Object.prototype.hasOwnProperty.call(input, "body") ? { body: input.body } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "starred") ? { starred: input.starred, pinned: input.starred } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "collectionId")
          ? { collectionId: input.collectionId, collectionSlug: collection?.slug ?? null }
          : {})
      };
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

async function renderWrite(ui: ReactNode = <Write />) {
  const view = render(ui);
  await waitFor(() => {
    expect(
      screen.queryByRole("region", { name: "Markdown editor" }) ?? screen.queryByLabelText("Workspace home")
    ).not.toBeNull();
  });
  if (screen.queryByLabelText("Workspace home")) {
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading saved docs" })).not.toBeInTheDocument());
    const firstDocument = await waitFor(() => {
      const button = view.container.querySelector<HTMLButtonElement>(".workspaceDocumentOpen");
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(firstDocument);
  }
  await screen.findByRole("region", { name: "Markdown editor" });
  await waitFor(() => expect(screen.queryByRole("status", { name: "Loading saved docs" })).not.toBeInTheDocument());
  return view;
}

async function createBlankDocument() {
  fireEvent.click(screen.getByRole("button", { name: "New document" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create blank document" }));
}

function openWorkspaceSearch() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

function openWorkspaceHome() {
  fireEvent.click(screen.getAllByRole("button", { name: "Home" })[0]);
}

function openSidebarCollection(name: string | RegExp) {
  const sidebar = screen.getByLabelText("Workspace navigation");
  const button = Array.from(sidebar.querySelectorAll("button")).find((candidate) =>
    typeof name === "string" ? candidate.textContent?.startsWith(name) : name.test(candidate.textContent ?? "")
  );
  expect(button).toBeDefined();
  fireEvent.click(button!);
}

async function openDocumentFromSearch(name: string | RegExp) {
  openWorkspaceSearch();
  const result = await screen.findByRole("button", { name });
  fireEvent.click(result);
  await screen.findByRole("region", { name: "Markdown editor" });
}

function deleteActiveDocument() {
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete document" }));
}

function publishActiveDocument() {
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish and copy link" }));
}

function makeActiveDocumentPrivate() {
  fireEvent.click(screen.getByRole("button", { name: "Shared" }));
  fireEvent.click(screen.getByRole("button", { name: "Make private" }));
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
  it("shows the shared context workflow, current pricing, and account actions for Pro users", async () => {
    render(<Landing />);

    expect(screen.getByRole("heading", { name: "One Markdown workspace for you and your agents." })).toBeInTheDocument();
    expect(screen.getByText(/one stable home instead of scattering them across/)).toBeInTheDocument();
    for (const cliLink of screen.getAllByRole("link", { name: "CLI" })) {
      expect(cliLink).toHaveAttribute("href", "/cli");
    }
    expect(await screen.findByText("Passage Pro is active.")).toBeInTheDocument();
    for (const workspaceLink of screen.getAllByRole("link", { name: "Open workspace" })) {
      expect(workspaceLink).toHaveAttribute("href", "/write");
    }
    expect(screen.getAllByRole("link", { name: "Account" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Account settings" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Go Pro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Upgrade" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Keep context and writing together." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Store stable context" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Find and write with it" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Use it from agents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Share deliberately" })).toBeInTheDocument();
    expect(screen.getByText(/Collections and indexed search organise the browser workspace/)).toBeInTheDocument();
    expect(screen.getByText(/A folder on one machine is a poor shared memory/)).toBeInTheDocument();
    expect(screen.getAllByText("$ passage list").length).toBeGreaterThan(0);
    expect(screen.getAllByText("passage cat <doc-id>").length).toBeGreaterThan(0);
    expect(screen.getAllByText("passage share <doc-id>").length).toBeGreaterThan(0);
    expect(screen.getByText("$5")).toHaveTextContent("$5 USD / month");
    expect(screen.getByText("Save thousands of documents")).toBeInTheDocument();
    expect(
      screen.getByText(/Renews monthly until cancelled/, {
        selector: "p:not([aria-hidden])",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Operated by/)).toBeInTheDocument();
    for (const merchantLink of screen.getAllByRole("link", { name: "Gradientwork Limited" })) {
      expect(merchantLink).toHaveAttribute("href", "https://gradientwork.com");
    }
    expect(screen.getByRole("link", { name: "owain@gradientwork.com" })).toHaveAttribute(
      "href",
      "mailto:owain@gradientwork.com"
    );
    for (const [name, href] of [
      ["Terms", "/terms"],
      ["Privacy", "/privacy"],
      ["Refunds", "/refunds"],
      ["Cancellation", "/cancellation"]
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("offers the account upgrade path to signed-in Free users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "user-1", email: "writer@example.com" },
            account: freeAccount
          }),
          { status: 200 }
        )
      )
    );

    render(<Landing />);

    expect(await screen.findByText("Free includes five saved documents.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "Go Pro" })).toHaveAttribute("href", "#pricing");
  });

  it("shows public signup actions only when the server enables them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            authenticated: false,
            publicSignupEnabled: true,
            policyVersion: "2026-07-31"
          }),
          { status: 200 }
        )
      )
    );

    render(<Landing />);

    expect(await screen.findByText("Free signup is open. No card required.")).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Create free account" })) {
      expect(link).toHaveAttribute("href", "/signup");
    }
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
  });

  it("offers sign in without advertising closed public signup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            authenticated: false,
            publicSignupEnabled: false,
            policyVersion: "2026-07-31"
          }),
          { status: 200 }
        )
      )
    );

    render(<Landing />);

    expect(await screen.findByText("Public signup is not open yet. Existing customers can sign in.")).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Sign in" })) {
      expect(link.getAttribute("href")).toMatch(/^\/login\?next=/);
    }
    expect(screen.queryByRole("link", { name: "Create free account" })).not.toBeInTheDocument();
  });

  it("does not guess the signup state while the session check is pending", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(<Landing />);

    for (const link of screen.getAllByRole("link", { name: "Start writing" })) {
      expect(link).toHaveAttribute("href", "/write");
    }
    expect(screen.queryByText(/Public signup is/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create free account" })).not.toBeInTheDocument();
  });

  it("does not claim signup is closed when the session check fails", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Landing />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/me", { credentials: "include" }));
    for (const link of screen.getAllByRole("link", { name: "Start writing" })) {
      expect(link).toHaveAttribute("href", "/write");
    }
    expect(screen.queryByText(/Public signup is/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create free account" })).not.toBeInTheDocument();
  });
});

describe("Policy pages", () => {
  it.each([
    ["Terms of Service", Terms],
    ["Privacy Policy", Privacy],
    ["Refund Policy", Refunds],
    ["Cancellation Policy", Cancellation]
  ])("publishes %s with support and policy navigation", (heading, Page) => {
    render(<Page />);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("Effective 31 July 2026")).toBeInTheDocument();
    for (const merchantLink of screen.getAllByRole("link", { name: "Gradientwork Limited" })) {
      expect(merchantLink).toHaveAttribute("href", "https://gradientwork.com");
    }
    expect(screen.getAllByRole("link", { name: "owain@gradientwork.com" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Policy links" })).toBeInTheDocument();
  });

  it("publishes the current monthly Pro price in the Terms", () => {
    render(<Terms />);

    expect(screen.getByText(/Passage Pro costs \$5 USD per month/)).toBeInTheDocument();
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
    expect(screen.getByText((content) => content.includes("/d/<public-id>.md"))).toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes("/d/<share-token>.md"))).not.toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("passage unshare <doc-id> revokes both URLs"))).toBeInTheDocument();
  });
});

describe("Account", () => {
  it("shows plan, usage, tokens, and starts checkout for free users", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: freeAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      if (url === "/api/v1/billing/checkout" && init?.method === "POST") {
        return new Response(JSON.stringify({ url: "https://checkout.stripe.test/session" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Account />);

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    const brand = screen.getByRole("link", { name: "passage.md home" });
    expect(brand).toHaveAttribute("href", "/write");
    expect(brand).toHaveTextContent(/^Passage$/);
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getByText("Saved documents")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data and policies" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Account policy links" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Cancellation" })).toHaveAttribute("href", "/cancellation");
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/billing/checkout",
        expect.objectContaining({ method: "POST", credentials: "include" })
      )
    );
  });

  it("does not open the Stripe portal for manually managed Pro accounts", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: manualProAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Account />);

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Billing is managed manually.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/billing/portal",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows exact near-limit Pro usage and a private prefilled support request", async () => {
    const nearLimitAccount = { ...proAccount, usage: { savedDocs: 1800 } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: nearLimitAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Account />);

    expect(await screen.findByText("1,800 of 2,000")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What do you need the higher limit for?"), {
      target: { value: "A larger private research library" }
    });
    const requestLink = screen.getByRole("link", { name: "Request a limit increase" });
    const href = decodeURIComponent(requestLink.getAttribute("href") ?? "");
    expect(href).toContain("Passage account: writer@example.com");
    expect(href).toContain("Current usage: 1800 of 2000 saved documents");
    expect(href).toContain("Purpose for the higher limit: A larger private research library");
    expect(href).not.toContain("# One");
    expect(href).not.toContain("Private server draft");
  });

  it("shows when a cancelled Stripe subscription's access ends", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "user-1", email: "writer@example.com" },
            account: {
              ...proAccount,
              subscription: {
                ...proAccount.subscription,
                currentPeriodEnd: "2026-08-27T12:00:00Z",
                cancelAtPeriodEnd: true
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Account />);

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Access ends")).toBeInTheDocument();
    expect(screen.queryByText("Renews")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
  });

  it("shows no-cost community access without Stripe actions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "community@example.com" }, account: communityProAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/api-tokens" && !init?.method) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Account />);

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    expect(screen.getByText("Community access")).toBeInTheDocument();
    expect(screen.getByText("Included at no cost. No renewal.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upgrade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
  });
});

describe("Referral signup", () => {
  it("captures and hides the referral URL before creating a no-cost Pro account", async () => {
	window.history.replaceState(null, "", "/signup?ref=aiengineer&code=pass-test-code");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      if (url === "/api/v1/auth/referral/validate" && init?.method === "POST") {
		return new Response(
          JSON.stringify({ name: "AI Engineer", policyVersion: "2026-07-31" }),
          { status: 200 }
        );
	  }
      if (url === "/api/v1/auth/referral-signup" && init?.method === "POST") {
        return new Response(JSON.stringify({ authenticated: true, user: { id: "user-1", email: "community@example.com" } }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Signup />);

	expect(await screen.findByText("AI Engineer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByText("Passage Pro is included with your community membership. No card or checkout is required.")).toBeInTheDocument();
	expect(window.location.pathname).toBe("/signup");
	expect(window.location.search).toBe("");
	expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "8");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "community@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/referral-signup",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          ref: "aiengineer",
          code: "pass-test-code",
          email: "community@example.com",
          password: "password123",
          policyVersion: "2026-07-31"
        })
      })
    ));
  });

  it("shows normal closed-beta signup behavior for an invalid referral", async () => {
	window.history.replaceState(null, "", "/signup?ref=aiengineer&code=invalid");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
	  if (String(input) === "/api/v1/auth/referral/validate" && init?.method === "POST") {
		return new Response(JSON.stringify({ error: "This referral link is invalid or no longer active." }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Signup />);
    expect(await screen.findByRole("heading", { name: "Passage is not open for signup yet" })).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
	expect(window.location.search).toBe("");
  });

  it("does not expose a signup form without referral credentials", async () => {
    window.history.replaceState(null, "", "/signup");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Signup />);

    expect(await screen.findByRole("heading", { name: "Passage is not open for signup yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/referral/validate", expect.anything());
  });
});

describe("Write (editor)", () => {
  it("surfaces repeated session failures and retries", async () => {
    let sessionRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests <= 2) {
          return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
        }
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?")) {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-retried", publicId: "retried", body: "# Retried session" }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Session could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: /Retried session/ })).toBeInTheDocument();
    expect(sessionRequests).toBe(3);
  });

  it("rechecks an unverified session before redirecting a protected route", async () => {
    let sessionRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          throw new TypeError("network unavailable");
        }
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?")) {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-recovered", publicId: "recovered", body: "# Recovered session" }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect(await screen.findByRole("button", { name: /Recovered session/ })).toBeInTheDocument();
    expect(sessionRequests).toBe(2);
  });

  it("does not flash loading copy while the session check resolves", async () => {
    let resolveSession: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v1/me") {
          return new Promise<Response>((resolve) => {
            resolveSession = resolve;
          });
        }
        return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
      })
    );

    render(<Write />);

    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
    await waitFor(() => expect(resolveSession).toBeDefined());
    resolveSession?.(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
  });

  it("hides the save status once server state is current", async () => {
    await renderWrite();

    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading saved docs")).not.toBeInTheDocument());
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("does not flash the starter document while saved docs load", async () => {
    let resolveDocs: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && method === "GET") {
        return new Promise<Response>((resolve) => {
          resolveDocs = resolve;
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect(await screen.findByRole("status", { name: "Loading saved docs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    expect(screen.queryByText("Markdown for agents and humans")).not.toBeInTheDocument();

    await waitFor(() => expect(resolveDocs).toBeDefined());
    resolveDocs?.(
      new Response(JSON.stringify({ documents: [{ id: "doc-notes", publicId: "notes-public-id", body: "# Agent notes" }] }), {
        status: 200
      })
    );

    expect(await screen.findByRole("button", { name: /Agent notes/ })).toBeInTheDocument();
    expect(screen.queryByText("Markdown for agents and humans")).not.toBeInTheDocument();
  });

  it("seeds a starter document titled from its first heading", async () => {
    await renderWrite();

    expect(screen.getAllByText("Markdown for agents and humans").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Workspace navigation")).toBeInTheDocument();
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
    const sidebar = document.querySelector<HTMLElement>('[aria-label="Workspace navigation"]');
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveAttribute("inert");
    expect(screen.queryByRole("complementary", { name: "Workspace navigation" })).not.toBeInTheDocument();
    const mobileNavigation = screen.getByRole("navigation", { name: "Mobile workspace navigation" });
    expect(Array.from(mobileNavigation.querySelectorAll("button")).every((button) => button.querySelector("svg"))).toBe(true);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia
    });
  });

  it("creates a document, updates its title, and renders Markdown preview", async () => {
    await renderWrite();

    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nThis is **ready**." }
    });

    expect(screen.getByRole("heading", { name: "Launch note", level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "This is ready.")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("creates, edits, and copies a Markdown template into an independent document", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-1", body: "# Existing" }]);
    await renderWrite();

    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByRole("heading", { name: "Create from a template" })).toBeInTheDocument();
    expect(screen.queryByText("Library")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    const title = await screen.findByRole("textbox", { name: "Template title" });
    expect(screen.queryByRole("button", { name: "Create document" })).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: "YouTube script" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Template description" }), {
      target: { value: "A clear structure for planning a YouTube video." }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Template Markdown" }), {
      target: { value: "# [Video title]\n\n## Opening\n\nWrite the hook." }
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/templates/template-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            title: "YouTube script",
            description: "A clear structure for planning a YouTube video.",
            body: "# [Video title]\n\n## Opening\n\nWrite the hook."
          })
        })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));
    expect(await screen.findByRole("heading", { name: "YouTube script" })).toBeInTheDocument();
    expect(screen.getByText("A clear structure for planning a YouTube video.")).toBeInTheDocument();
    expect(screen.queryByText("Write the hook.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit YouTube script" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create document from YouTube script" }));

    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    expect(editor).toHaveValue("# [Video title]\n\n## Opening\n\nWrite the hook.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "# [Video title]\n\n## Opening\n\nWrite the hook." })
      })
    );
  });

  it("disables template creation until the template library finishes loading", async () => {
    const signedInFetch = stubSignedInFetch();
    let resolveTemplates: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v1/templates" && (init?.method ?? "GET") === "GET") {
          return new Promise<Response>((resolve) => {
            resolveTemplates = resolve;
          });
        }
        return signedInFetch(input, init);
      })
    );

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));

    const newTemplate = screen.getByRole("button", { name: "New template" });
    expect(newTemplate).toBeDisabled();
    await waitFor(() => expect(resolveTemplates).toBeDefined());
    resolveTemplates?.(new Response(JSON.stringify({ templates: [] }), { status: 200 }));
    await waitFor(() => expect(newTemplate).toBeEnabled());
  });

  it("deletes a template and frees its library slot", async () => {
    const confirmDelete = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubSignedInFetch();
    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    await screen.findByRole("textbox", { name: "Template title" });
    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));
    expect(await screen.findByText("No description.")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Delete Untitled template" }));

    expect(confirmDelete).toHaveBeenCalledWith("Delete “Untitled template”? This cannot be undone.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/templates/template-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(await screen.findByText("0 of 10")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Untitled template" })).not.toBeInTheDocument();
  });

  it("keeps a template when deletion is cancelled", async () => {
    const confirmDelete = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = stubSignedInFetch();
    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    await screen.findByRole("textbox", { name: "Template title" });
    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete Untitled template" }));

    expect(confirmDelete).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/templates/template-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(screen.getByRole("heading", { name: "Untitled template" })).toBeInTheDocument();
    expect(screen.getByText("1 of 10")).toBeInTheDocument();
  });

  it("requires confirmation before deleting from the template editor", async () => {
    const confirmDelete = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = stubSignedInFetch();
    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    await screen.findByRole("textbox", { name: "Template title" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Untitled template" }));

    expect(confirmDelete).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/templates/template-1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(screen.getByRole("textbox", { name: "Template title" })).toBeInTheDocument();
  });

  it("keeps a template visible when deletion fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const signedInFetch = stubSignedInFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v1/templates/template-1" && init?.method === "DELETE") {
          return Promise.resolve(new Response(JSON.stringify({ error: "delete failed" }), { status: 500 }));
        }
        return signedInFetch(input, init);
      })
    );
    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    await screen.findByRole("textbox", { name: "Template title" });
    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete Untitled template" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("delete failed");
    expect(screen.getByRole("heading", { name: "Untitled template" })).toBeInTheDocument();
    expect(screen.getByText("1 of 10")).toBeInTheDocument();
  });

  it("filters the document list by title and body text", async () => {
    const fetchMock = stubSignedInFetch();
    await renderWrite();

    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nRoadmap coverage." }
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/docs\/doc-\d+$/),
      expect.objectContaining({ method: "PATCH" })
    ));
    openWorkspaceSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents and tags" }), {
      target: { value: "roadmap" }
    });

    const launchNote = await screen.findByRole("button", { name: /Launch note/ });
    expect(launchNote).toBeInTheDocument();
    expect(launchNote).toHaveTextContent("Roadmap coverage");
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

    await openDocumentFromSearch(/Agent notes/);

    expect(screen.getAllByRole("heading", { name: "Agent notes", level: 1 }).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/write/notes-public-id");
  });

  it("restores workspace home when browser history returns to /write", async () => {
    stubSignedInFetch([{ id: "doc-notes", publicId: "notes-public-id", body: "# Agent notes\n\nFollow ups." }]);

    await renderWrite();
    expect(window.location.pathname).toBe("/write/notes-public-id");

    act(() => {
      window.history.pushState(null, "", "/write");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Markdown editor" })).not.toBeInTheDocument();
  });

  it("restores a document when browser history returns to its stable URL", async () => {
    stubSignedInFetch([{ id: "doc-notes", publicId: "notes-public-id", body: "# Agent notes\n\nFollow ups." }]);

    await renderWrite();
    openWorkspaceHome();
    act(() => {
      window.history.pushState(null, "", "/write/notes-public-id");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Agent notes", level: 1 }).length).toBeGreaterThan(0);
  });

  it("restores a document requested by popstate during the initial document load", async () => {
    let resolveDocs: ((response: Response) => void) | undefined;
    const baseFetch = stubSignedInFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs?limit=50") {
        return new Promise<Response>((resolve) => { resolveDocs = resolve; });
      }
      return baseFetch(input, init);
    }));
    window.history.replaceState(null, "", "/write");
    render(<Write />);
    await waitFor(() => expect(resolveDocs).toBeDefined());

    act(() => {
      window.history.pushState(null, "", "/write/later");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByRole("status", { name: "Loading document" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/write/later");
    await act(async () => {
      resolveDocs!(new Response(JSON.stringify({
        documents: [{ id: "doc-later", publicId: "later", body: "# Later note" }]
      }), { status: 200 }));
    });

    expect((await screen.findAllByRole("heading", { name: "Later note", level: 1 })).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/write/later");
  });

  it("waits for a later document page before resolving popstate", async () => {
    let resolveLaterPage: ((response: Response) => void) | undefined;
    const baseFetch = stubSignedInFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/docs?limit=50") {
        return Promise.resolve(new Response(JSON.stringify({
          documents: [{ id: "doc-current", publicId: "current", body: "# Current note" }],
          nextCursor: "page-two"
        }), { status: 200 }));
      }
      if (url === "/api/v1/docs?limit=50&cursor=page-two") {
        return new Promise<Response>((resolve) => { resolveLaterPage = resolve; });
      }
      return baseFetch(input, init);
    }));
    window.history.replaceState(null, "", "/write/current");
    render(<Write />);
    expect((await screen.findAllByRole("heading", { name: "Current note", level: 1 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(resolveLaterPage).toBeDefined());

    act(() => {
      window.history.pushState(null, "", "/write/later");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    const writingPane = await screen.findByRole("region", { name: "Markdown editor" });
    expect(await screen.findByRole("status", { name: "Loading document" })).toBeInTheDocument();
    expect(writingPane).not.toHaveTextContent("Current note");
    expect(window.location.pathname).toBe("/write/later");
    await act(async () => {
      resolveLaterPage!(new Response(JSON.stringify({
        documents: [{ id: "doc-later", publicId: "later", body: "# Later note" }]
      }), { status: 200 }));
    });

    expect((await screen.findAllByRole("heading", { name: "Later note", level: 1 })).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/write/later");
  });

  it("keeps a document history URL when a later document page fails", async () => {
    const baseFetch = stubSignedInFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/docs?limit=50") {
        return Promise.resolve(new Response(JSON.stringify({
          documents: [{ id: "doc-current", publicId: "current", body: "# Current note" }],
          nextCursor: "page-two"
        }), { status: 200 }));
      }
      if (url === "/api/v1/docs?limit=50&cursor=page-two") {
        return Promise.resolve(new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 }));
      }
      return baseFetch(input, init);
    }));
    window.history.replaceState(null, "", "/write/current");
    render(<Write />);
    expect((await screen.findAllByRole("heading", { name: "Current note", level: 1 })).length).toBeGreaterThan(0);
    await screen.findByText("Some documents could not be indexed. Load the next page to try again.");

    act(() => {
      window.history.pushState(null, "", "/write/later");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    const writingPane = await screen.findByRole("region", { name: "Markdown editor" });
    expect(await screen.findByRole("heading", { name: "Document could not be checked." })).toBeInTheDocument();
    expect(writingPane).not.toHaveTextContent("Current note");
    expect(window.location.pathname).toBe("/write/later");
  });

  it.each([
    ["/write", "Workspace home"],
    ["/write?view=starred", "Starred"],
    ["/write?view=recent", "Recent"],
    ["/write?view=collections", "Collections"],
    ["/write?collection=research", "Research"]
  ])("restores the canonical workspace URL %s on direct load", async (path, label) => {
    window.history.replaceState(null, "", path);

    render(<Write />);

    expect(await screen.findByLabelText(label)).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe(path);
  });

  it("restores Templates on direct load", async () => {
    window.history.replaceState(null, "", "/write?view=templates");

    render(<Write />);

    expect(await screen.findByRole("heading", { name: "Create from a template" })).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=templates");
  });

  it("uses Back and Forward to restore Collections and an individual collection", async () => {
    render(<Write />);
    await screen.findByLabelText("Workspace home");

    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=collections");
    const collections = screen.getByLabelText("Collections");
    fireEvent.click(Array.from(collections.querySelectorAll<HTMLButtonElement>(".workspaceCollectionCard"))
      .find((button) => button.textContent?.includes("Research"))!);
    expect(await screen.findByLabelText("Research")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?collection=research");

    act(() => window.history.back());
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=collections"));
    expect(screen.getByLabelText("Collections")).toBeInTheDocument();

    act(() => window.history.forward());
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/write?collection=research"));
    expect(screen.getByLabelText("Research")).toBeInTheDocument();
  });

  it("keeps Templates in workspace history", async () => {
    render(<Write />);
    await screen.findByLabelText("Workspace home");

    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByRole("heading", { name: "Create from a template" })).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=templates");
    fireEvent.click(screen.getAllByRole("button", { name: "Home" })[0]);
    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=templates"));
    expect(screen.getByRole("heading", { name: "Create from a template" })).toBeInTheDocument();
  });

  it("does not push duplicate history for the active workspace destination", async () => {
    render(<Write />);
    await screen.findByLabelText("Workspace home");
    const pushState = vi.spyOn(window.history, "pushState");

    for (const home of screen.getAllByRole("button", { name: "Home" })) fireEvent.click(home);
    expect(pushState).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    expect(pushState).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("restores the collection that opened a document when Back is pressed", async () => {
    stubSignedInFetch([{
      id: "doc-research",
      publicId: "research-note",
      body: "# Research note",
      collectionId: "collection-research",
      collectionSlug: "research"
    }]);
    render(<Write />);
    await screen.findByLabelText("Workspace home");
    openSidebarCollection("Research");
    fireEvent.click(screen.getByLabelText("Research").querySelector<HTMLButtonElement>(".workspaceDocumentOpen")!);
    expect(await screen.findByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/write/research-note");

    act(() => window.history.back());

    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/write?collection=research"));
    expect(screen.getByLabelText("Research")).toBeInTheDocument();
  });

  it("replaces unknown views with Home", async () => {
    window.history.replaceState(null, "", "/write?view=unknown");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(<Write />);

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/write");
  });

  it("replaces a missing collection with the collection index and a clear message", async () => {
    window.history.replaceState(null, "", "/write?collection=missing");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(<Write />);

    expect(await screen.findByLabelText("Collections")).toBeInTheDocument();
    expect(await screen.findByText("Collection could not be found")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=collections");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/write?view=collections");
  });

  it("keeps a custom collection URL without substituting Documents when collection loading fails", async () => {
    const baseFetch = stubSignedInFetch([{ id: "doc-research", body: "# Research note" }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/collections" && (init?.method ?? "GET") === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ error: "Collections unavailable" }), { status: 503 }));
      }
      return baseFetch(input, init);
    }));
    window.history.replaceState(null, "", "/write?collection=research");

    render(<Write />);

    expect(await screen.findByLabelText("Collection unavailable")).toHaveTextContent("Collection could not be loaded");
    expect(screen.getByText("Collections unavailable")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?collection=research");
    expect(screen.queryByLabelText("Documents")).not.toBeInTheDocument();
  });

  it("recovers a stale document URL without showing another document under it", async () => {
    stubSignedInFetch([{ id: "doc-current", publicId: "current", body: "# Current note" }]);
    window.history.replaceState(null, "", "/write/stale");

    render(<Write />);

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    expect(await screen.findByText("Document could not be found")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write");
    expect(screen.queryByRole("region", { name: "Markdown editor" })).not.toBeInTheDocument();
  });

  it("filters the document list by frontmatter tags", async () => {
    stubSignedInFetch([
      { id: "doc-notes", body: "---\ntags: [notes]\n---\n\n# Agent notes\n\nFollow ups." },
      { id: "doc-scripts", body: "---\ntags: [scripts]\n---\n\n# Video script\n\nOpening line." }
    ]);

    await renderWrite();
    openWorkspaceSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents and tags" }), {
      target: { value: "scripts" }
    });

    expect(await screen.findByRole("button", { name: /Video script/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agent notes/ })).not.toBeInTheDocument();
  });

  it("scopes workspace search to persisted collection membership without inferring tags", async () => {
    stubSignedInFetch([
      { id: "doc-notes", body: "---\ntags: [content-studio]\n---\n\n# Agent notes\n\nFollow ups.", collectionId: "collection-context", collectionSlug: "operating-context" },
      { id: "doc-scripts", body: "# Video script\n\nOpening line.", collectionId: "collection-content", collectionSlug: "content-studio" }
    ]);

    await renderWrite();
    openWorkspaceSearch();
    fireEvent.click(screen.getByRole("button", { name: "Content Studio" }));
    expect(screen.getByRole("button", { name: /Video script/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agent notes/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: /Agent notes/ })).toBeInTheDocument();
  });

  it("groups documents in collections instead of one flat sidebar", async () => {
    stubSignedInFetch([
      { id: "doc-context", body: "# About me\n\nStable context.", collectionId: "collection-context", collectionSlug: "operating-context" },
      { id: "doc-draft", body: "# Newsletter draft\n\nWorking copy.", collectionId: "collection-content", collectionSlug: "content-studio" }
    ]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Operating Context");
    const collection = screen.getByLabelText("Operating Context");
    expect(collection).toBeInTheDocument();
    expect(collection).toHaveTextContent("About me");
    expect(screen.queryByRole("button", { name: /Newsletter draft/ })).not.toBeInTheDocument();
  });

  it("persists a document move before showing it in the new collection", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    fireEvent.change(screen.getByRole("combobox", { name: "Collection for Private note" }), {
      target: { value: "research" }
    });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Collection for Private note" })).not.toBeDisabled());
    openWorkspaceHome();
    openSidebarCollection("Research");

    expect(screen.getByLabelText("Research")).toHaveTextContent("Private note");
    expect(screen.getByLabelText("Research")).toHaveTextContent("Research notes.");
  });

  it("keeps a pending document save when navigation returns to the workspace", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-draft", publicId: "draft", body: "# Draft" }]);
    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Draft\n\nSaved after navigation." }
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Home" })[0]);

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/docs/doc-draft",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "# Draft\n\nSaved after navigation." })
      })
    ));
  });

  it("moves a document to a collection and back through controls available at 390 pixels", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({ matches: query === "(max-width: 720px)" }))
    });
    stubSignedInFetch([{ id: "doc-mobile", publicId: "mobile", body: "# Mobile note" }]);

    await renderWrite();
    const documentCollection = screen.getByRole("combobox", { name: "Collection for Mobile note" });
    fireEvent.change(documentCollection, { target: { value: "research" } });
    await waitFor(() => expect(documentCollection).toHaveValue("research"));

    openSidebarCollection("Research");
    const rowCollection = await screen.findByRole("combobox", { name: "Collection for Mobile note" });
    fireEvent.change(rowCollection, { target: { value: "documents" } });
    await waitFor(() => expect(screen.getByLabelText("Research")).not.toHaveTextContent("Mobile note"));
    openSidebarCollection("Documents");
    expect(screen.getByLabelText("Documents")).toHaveTextContent("Mobile note");

    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("keeps the confirmed mobile collection when assignment fails", async () => {
    const baseFetch = stubSignedInFetch([{ id: "doc-mobile", publicId: "mobile", body: "# Mobile note" }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-mobile" && init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({ error: "move failed" }), { status: 500 }));
      }
      return baseFetch(input, init);
    }));
    await renderWrite();
    const collection = screen.getByRole("combobox", { name: "Collection for Mobile note" });

    fireEvent.change(collection, { target: { value: "research" } });

    expect(await screen.findByText("move failed")).toBeInTheDocument();
    expect(collection).toHaveValue("documents");
  });

  it("shows a clear empty state for a collection with no documents", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Research");

    expect(screen.getByText("No documents here yet. Use + in the top bar to add the first one.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New document" }).length).toBeGreaterThan(0);
  });

  it("disables star and collection controls while persistence is pending", async () => {
    const baseFetch = stubSignedInFetch([{
      id: "doc-pending",
      body: "# Pending controls",
      pinned: false,
      starred: false
    }]);
    let resolveStar: ((response: Response) => void) | undefined;
    let resolveCollection: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (url === "/api/v1/docs/doc-pending" && method === "PATCH" && Object.prototype.hasOwnProperty.call(body, "starred")) {
        return new Promise<Response>((resolve) => { resolveStar = resolve; });
      }
      if (url === "/api/v1/collections" && method === "POST") {
        return new Promise<Response>((resolve) => { resolveCollection = resolve; });
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Star document" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Star document" })).toBeDisabled());
    await act(async () => {
      resolveStar!(new Response(JSON.stringify({
        id: "doc-pending",
        publicId: "public-1",
        body: "# Pending controls",
        collectionId: null,
        collectionSlug: null,
        starred: true
      }), { status: 200 }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Unstar document" })).toBeEnabled());

    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New collection" }).at(-1)!);
    fireEvent.change(screen.getByRole("textbox", { name: "Collection title" }), { target: { value: "Pending collection" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    expect(screen.getByRole("textbox", { name: "Collection title" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "New collection" })).toHaveFocus();
    await act(async () => {
      resolveCollection!(new Response(JSON.stringify({
        id: "collection-pending",
        slug: "pending-collection",
        title: "Pending collection",
        description: null,
        createdAt: "2026-08-15T10:00:00Z",
        updatedAt: "2026-08-15T10:00:00Z"
      }), { status: 201 }));
    });
    expect(await screen.findByLabelText("Pending collection")).toBeInTheDocument();
  });

  it("keeps assignment disabled until collections load and after failure", async () => {
    let rejectCollections: ((reason?: unknown) => void) | undefined;
    const baseFetch = stubSignedInFetch([{
      id: "doc-assigned",
      publicId: "assigned",
      body: "# Assigned note",
      collectionId: "collection-research",
      collectionSlug: "research"
    }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/collections" && (init?.method ?? "GET") === "GET") {
        return new Promise<Response>((_, reject) => { rejectCollections = reject; });
      }
      return baseFetch(input, init);
    }));
    window.history.replaceState(null, "", "/write/assigned");

    render(<Write />);
    const collection = await screen.findByRole("combobox", { name: "Collection for Assigned note" });
    expect(collection).toBeDisabled();
    await act(async () => rejectCollections!(new Error("collection outage")));

    expect(await screen.findByText("collection outage")).toBeInTheDocument();
    expect(collection).toBeDisabled();
    fireEvent.change(collection, { target: { value: "documents" } });
    expect(baseFetch).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-assigned",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("creates a collection and makes it available across the workspace", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New collection" }).at(-1)!);
    fireEvent.change(screen.getByRole("textbox", { name: "Collection title" }), { target: { value: "Client Work" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Collection description" }), { target: { value: "Briefs and decisions." } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    expect(await screen.findByLabelText("Client Work")).toHaveTextContent("Briefs and decisions.");
    expect(screen.getByLabelText("Workspace navigation")).toHaveTextContent("Client Work");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Client Work" })).toHaveFocus());
    openWorkspaceSearch();
    expect(screen.getByRole("button", { name: "Client Work" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Search workspace" }), { key: "Escape" });
    openSidebarCollection("Documents");
    fireEvent.change(screen.getByRole("combobox", { name: "Collection for Private note" }), { target: { value: "client-work" } });
    await waitFor(() => expect(screen.getByLabelText("Documents")).not.toHaveTextContent("Private note"));
    openSidebarCollection("Client Work");
    expect(screen.getByLabelText("Client Work")).toHaveTextContent("Private note");
  });

  it("keeps a user-created Documents collection distinct from the fallback", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "New collection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Collection title" }), { target: { value: "Documents" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    await waitFor(() => expect(screen.getByLabelText("Workspace navigation")).toHaveTextContent("Documents"));
    openSidebarCollection("Documents");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renames a collection and keeps its document assignments", async () => {
    stubSignedInFetch([{ id: "doc-context", body: "# Findings", collectionId: "collection-research", collectionSlug: "research" }]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Research");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Collection title" }), { target: { value: "Discovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByLabelText("Discovery")).toHaveTextContent("Findings");
    expect(screen.getByLabelText("Workspace navigation")).toHaveTextContent("Discovery");
  });

  it("keeps failed collection saves inside the dialog and restores input focus", async () => {
    const baseFetch = stubSignedInFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/collections/research" && init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({ error: "save failed" }), { status: 500 }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Research");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByRole("textbox", { name: "Collection title" });
    fireEvent.change(title, { target: { value: "Discovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "save failed"
    );
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getAllByText("save failed")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Edit collection" })).toBeInTheDocument();
  });

  it("shows actionable collection creation failures inside the dialog", async () => {
    const baseFetch = stubSignedInFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/collections" && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ error: "collection limit reached" }), { status: 409 }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New collection" }).at(-1)!);
    const title = screen.getByRole("textbox", { name: "Collection title" });
    fireEvent.change(title, { target: { value: "One too many" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("collection limit reached");
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getAllByText("collection limit reached")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "New collection" })).toBeInTheDocument();
  });

  it("closes collection creation with Escape without adding it", async () => {
    stubSignedInFetch();

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    const trigger = screen.getAllByRole("button", { name: "New collection" }).at(-1)!;
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "New collection" }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "New collection" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Workspace navigation")).not.toHaveTextContent("New collection");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("portals collection dialogs to the viewport and contains keyboard focus", async () => {
    stubSignedInFetch();

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    const trigger = screen.getAllByRole("button", { name: "New collection" }).at(-1)!;
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "New collection" });
    const backdrop = dialog.parentElement!;
    const title = screen.getByRole("textbox", { name: "Collection title" });
    expect(backdrop).toHaveClass("workspace", "workspaceCollectionDialogBackdrop");
    expect(backdrop.parentElement).toBe(document.body);
    expect(dialog.closest(".workspace")).toBe(backdrop);
    expect(Array.from(document.body.children).filter((element) => element !== backdrop)
      .every((element) => element.hasAttribute("inert"))).toBe(true);
    expect(document.body).toHaveStyle({ overflow: "hidden" });
    expect(title).toHaveFocus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "New collection" })).toBeInTheDocument();
    expect(title).toHaveFocus();

    fireEvent.change(title, { target: { value: "Focus test" } });
    const submit = screen.getByRole("button", { name: "Create collection" });
    fireEvent.keyDown(title, { key: "Tab", shiftKey: true });
    expect(submit).toHaveFocus();
    fireEvent.keyDown(submit, { key: "Tab" });
    expect(title).toHaveFocus();
    trigger.focus();
    expect(title).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveStyle({ overflow: "hidden" });
    expect(Array.from(document.body.children).some((element) => element.hasAttribute("inert"))).toBe(false);
  });

  it("uses the shared modal contract for editing and deleting collections", async () => {
    stubSignedInFetch();

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Research");

    const editTrigger = screen.getByRole("button", { name: "Edit" });
    editTrigger.focus();
    fireEvent.click(editTrigger);
    const editDialog = screen.getByRole("dialog", { name: "Edit collection" });
    const editBackdrop = editDialog.parentElement!;
    expect(editDialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole("textbox", { name: "Collection title" })).toHaveFocus();
    fireEvent.pointerDown(editDialog);
    fireEvent.click(editBackdrop);
    expect(editDialog).toBeInTheDocument();
    fireEvent.pointerDown(editBackdrop);
    fireEvent.click(editBackdrop);
    await waitFor(() => expect(editTrigger).toHaveFocus());

    const deleteTrigger = screen.getByRole("button", { name: "Delete" });
    deleteTrigger.focus();
    fireEvent.click(deleteTrigger);
    const deleteDialog = screen.getByRole("dialog", { name: "Delete collection" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete collection" });
    expect(deleteDialog.parentElement?.parentElement).toBe(document.body);
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(deleteDialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Delete collection" })).not.toBeInTheDocument();
    await waitFor(() => expect(deleteTrigger).toHaveFocus());
  });

  it("opens collection creation from the sidebar while Collections is already open", async () => {
    stubSignedInFetch();

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New collection" })[0]);

    expect(screen.getByRole("dialog", { name: "New collection" })).toBeInTheDocument();
  });

  it("can recreate a deleted custom collection name", async () => {
    stubSignedInFetch();

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getByRole("button", { name: "View all collections" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New collection" }).at(-1)!);
    fireEvent.change(screen.getByRole("textbox", { name: "Collection title" }), { target: { value: "Client Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    await screen.findByLabelText("Client Work");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    await screen.findByLabelText("Collections");
    fireEvent.click(screen.getAllByRole("button", { name: "New collection" }).at(-1)!);
    fireEvent.change(screen.getByRole("textbox", { name: "Collection title" }), { target: { value: "Client Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    expect(await screen.findByLabelText("Client Work")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace navigation")).toHaveTextContent("Client Work");
  });

  it("assigns a document created from a collection back to that collection", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note" }]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Research");
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create blank document" }));
    await screen.findByRole("region", { name: "Markdown editor" });

    expect(screen.getByRole("combobox", { name: "Collection for Untitled" })).toHaveValue("research");
    openSidebarCollection("Research");
    expect(screen.getByLabelText("Research")).toHaveTextContent("Untitled");
  });

  it("deletes a collection and moves its documents to Documents after dialog confirmation", async () => {
    stubSignedInFetch([{ id: "doc-context", body: "# About me\n\nStable context.", collectionId: "collection-context", collectionSlug: "operating-context" }]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Operating Context");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog", { name: "Delete collection" })).toHaveTextContent(
      "Delete “Operating Context”? 1 document will move to Documents."
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    expect(await screen.findByLabelText("Collections")).toBeInTheDocument();
    expect(screen.getByText("“Operating Context” was deleted. Its documents are now in Documents.")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write?view=collections");
    expect(screen.getByLabelText("Workspace navigation")).not.toHaveTextContent("Operating Context");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "New collection" }).at(-1)).toHaveFocus());
    openSidebarCollection("Documents");
    expect(screen.getByLabelText("Documents")).toHaveTextContent("About me");
  });

  it("discards an assignment response after its collection is deleted", async () => {
    let resolveAssignment: ((response: Response) => void) | undefined;
    const baseFetch = stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (String(input) === "/api/v1/docs/doc-private" && init?.method === "PATCH" && body.collectionId === "collection-research") {
        return new Promise<Response>((resolve) => { resolveAssignment = resolve; });
      }
      return baseFetch(input, init);
    }));
    await renderWrite();
    fireEvent.change(screen.getByRole("combobox", { name: "Collection for Private note" }), { target: { value: "research" } });
    await waitFor(() => expect(resolveAssignment).toBeDefined());
    openWorkspaceHome();
    openSidebarCollection("Research");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    await screen.findByLabelText("Collections");
    await act(async () => {
      resolveAssignment!(new Response(JSON.stringify({
        id: "doc-private",
        publicId: "public-1",
        body: "# Private note\n\nDraft.",
        collectionId: "collection-research",
        collectionSlug: "research",
        starred: false
      }), { status: 200 }));
    });

    openSidebarCollection("Documents");
    expect(screen.getByLabelText("Documents")).toHaveTextContent("Private note");
    expect(screen.getByLabelText("Workspace navigation")).not.toHaveTextContent("Research");
  });

  it("shows a later-loaded document from a deleted collection as Documents", async () => {
    let resolveLaterPage: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/collections" && !init?.method) {
        return new Response(JSON.stringify({ collections: [
          { id: "collection-research", slug: "research", title: "Research", description: "Research notes.", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" }
        ] }), { status: 200 });
      }
      if (url === "/api/v1/collections/research" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/v1/docs?limit=50") {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-context", publicId: "context", body: "# First research", collectionId: "collection-research", collectionSlug: "research", starred: false }], nextCursor: "page-two" }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50&cursor=page-two") {
        return new Promise<Response>((resolve) => { resolveLaterPage = resolve; });
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Write />);
    await screen.findByLabelText("Workspace home");
    openSidebarCollection("Research");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    await screen.findByLabelText("Collections");
    await waitFor(() => expect(resolveLaterPage).toBeDefined());
    resolveLaterPage?.(
      new Response(
        JSON.stringify({ documents: [{ id: "doc-later", publicId: "later", body: "# Later research", collectionId: "collection-research", collectionSlug: "research", starred: false }] }),
        { status: 200 }
      )
    );

    openWorkspaceSearch();
    const searchDialog = await screen.findByRole("dialog", { name: "Search workspace" });
    const searchResult = await waitFor(() => {
      const result = Array.from(searchDialog.querySelectorAll<HTMLButtonElement>(".workspaceSearchResults button"))
        .find((button) => button.textContent?.includes("Later research"));
      expect(result).toBeDefined();
      return result!;
    });
    fireEvent.click(searchResult);
    await screen.findByRole("region", { name: "Markdown editor" });
    expect(screen.getByRole("combobox", { name: "Collection for Later research" })).toHaveValue("documents");
  });

  it("keeps a collection when deletion is cancelled", async () => {
    stubSignedInFetch([{ id: "doc-context", body: "---\ntags: [operating-context]\n---\n\n# About me" }]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Operating Context");
    const trigger = screen.getByRole("button", { name: "Delete" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Delete collection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Operating Context")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace navigation")).toHaveTextContent("Operating Context");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows collection deletion failures inside the modal", async () => {
    let resolveDelete: ((response: Response) => void) | undefined;
    const baseFetch = stubSignedInFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/collections/research" && init?.method === "DELETE") {
        return new Promise<Response>((resolve) => { resolveDelete = resolve; });
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Research");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    await waitFor(() => expect(resolveDelete).toBeDefined());
    expect(screen.getByRole("dialog", { name: "Delete collection" })).toHaveFocus();
    await act(async () => {
      resolveDelete!(new Response(JSON.stringify({ error: "delete failed" }), { status: 500 }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Collection could not be deleted. Try again."
    );
    expect(screen.queryByText("delete failed")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete collection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete collection" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("protects the Documents fallback collection from deletion", async () => {
    stubSignedInFetch([{ id: "doc-general", body: "# Scratch" }]);

    await renderWrite();
    openWorkspaceHome();
    openSidebarCollection("Documents");

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("continues to the next document after deleting the active document", async () => {
    stubSignedInFetch([
      { id: "doc-private", body: "# Private note\n\nDraft." },
      { id: "doc-shared", body: "# Shared note\n\nPublished.", sharedAt: "2026-07-09T08:00:00Z" }
    ]);

    await renderWrite();
    deleteActiveDocument();

    expect((await screen.findAllByRole("heading", { name: "Shared note", level: 1 })).length).toBeGreaterThan(0);
  });

  it("does not delete a document until the confirmation action", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog", { name: "Delete document" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-private",
      expect.objectContaining({ method: "DELETE" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete document" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Private note", level: 1 }).length).toBeGreaterThan(0);
  });

  it("deletes the final document and returns to Home", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-only", body: "# Only note\n\nDraft." }]);

    const { unmount } = await renderWrite();

    deleteActiveDocument();

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Only note/ })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/write");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-only", {
      method: "DELETE",
      credentials: "include"
    });

    unmount();
    render(<Write />);

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("does not replace a newer workspace URL when document deletion finishes late", async () => {
    let resolveDelete: ((response: Response) => void) | undefined;
    const baseFetch = stubSignedInFetch([
      { id: "doc-private", body: "# Private note\n\nDraft." },
      { id: "doc-next", body: "# Next note\n\nKeep." }
    ]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-private" && init?.method === "DELETE") {
        return new Promise<Response>((resolve) => { resolveDelete = resolve; });
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    deleteActiveDocument();
    await waitFor(() => expect(resolveDelete).toBeDefined());
    openWorkspaceHome();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write");

    await act(async () => resolveDelete!(new Response(null, { status: 204 })));

    expect(await screen.findByLabelText("Workspace home")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/write");
    expect(screen.queryByRole("region", { name: "Markdown editor" })).not.toBeInTheDocument();
  });

  it("cancels a pending autosave when deleting its document", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-only", body: "# Only note\n\nDraft." }]);

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Edited note\n\nUnsaved." }
    });

    deleteActiveDocument();

    await waitFor(() => expect(screen.getByText("No documents yet.")).toBeInTheDocument());
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-only",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("keeps a newer autosave when deleting another document fails", async () => {
    const fetchMock = stubSignedInFetch([
      { id: "doc-first", body: "# First note\n\nDraft." },
      { id: "doc-second", body: "# Second note\n\nDraft." }
    ]);
    const defaultFetch = fetchMock.getMockImplementation();
    let resolveDelete: ((response: Response) => void) | undefined;
    const deleteResponse = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-first" && init?.method === "DELETE") {
        return deleteResponse;
      }
      return defaultFetch!(input, init);
    });

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# First edit\n\nUnsaved." }
    });
    deleteActiveDocument();

    await openDocumentFromSearch(/Second note/);
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Second edit\n\nKeep this." }
    });
    resolveDelete!(new Response(JSON.stringify({ error: "delete failed" }), { status: 500 }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/docs/doc-second",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ body: "# Second edit\n\nKeep this." })
        })
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/docs/doc-first",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "# First edit\n\nUnsaved." })
      })
    );
  });

  it("keeps starred documents separate from the recent ordering", async () => {
    stubSignedInFetch([
      {
        id: "doc-old",
        body: "# Old note",
        updatedAt: "2026-07-09T08:00:00Z"
      },
      {
        id: "doc-pinned",
        body: "# Pinned note",
        pinned: true,
        updatedAt: "2026-07-09T07:00:00Z"
      },
      {
        id: "doc-new",
        body: "# Latest note",
        updatedAt: "2026-07-09T09:00:00Z"
      }
    ]);

    await renderWrite();
    openWorkspaceHome();
    fireEvent.click(screen.getAllByRole("button", { name: /Recent/ })[0]);
    const rows = Array.from(screen.getByLabelText("Recent").querySelectorAll<HTMLButtonElement>(".workspaceDocumentOpen"))
      .map((button) => button.textContent ?? "");
    expect(rows[0]).toContain("Latest note");
    expect(rows[1]).toContain("Old note");
    expect(rows[2]).toContain("Pinned note");
    fireEvent.click(screen.getAllByRole("button", { name: /Starred/ })[0]);
    expect(screen.getByLabelText("Starred")).toHaveTextContent("Pinned note");
    expect(screen.queryByRole("button", { name: /Latest note/ })).not.toBeInTheDocument();
  });

  it("moves a metadata-updated document to its confirmed recent position", async () => {
    const baseFetch = stubSignedInFetch([
      { id: "doc-old", body: "# Older note", updatedAt: "2026-08-15T08:00:00Z" },
      { id: "doc-new", body: "# Newer note", updatedAt: "2026-08-15T09:00:00Z" }
    ]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-old" && init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({
          id: "doc-old",
          publicId: "public-1",
          body: "# Older note",
          collectionId: null,
          collectionSlug: null,
          starred: true,
          updatedAt: "2026-08-15T10:00:00Z"
        }), { status: 200 }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    await openDocumentFromSearch(/Older note/);
    fireEvent.click(screen.getByRole("button", { name: "Star document" }));
    await screen.findByRole("button", { name: "Unstar document" });
    openWorkspaceHome();
    fireEvent.click(screen.getAllByRole("button", { name: "Recent" })[0]);

    const recent = await screen.findByLabelText("Recent");
    const rows = recent.querySelectorAll(".workspaceDocumentOpen");
    expect(rows[0]).toHaveTextContent("Older note");
    expect(rows[1]).toHaveTextContent("Newer note");
  });

  it("marks a document as shared without leaving the editor", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fetchMock = stubSignedInFetch();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("dialog", { name: "Share document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-welcome/share",
      expect.objectContaining({ method: "POST" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish and copy link" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("keeps sharing independent from collection assignment", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    stubSignedInFetch([
      { id: "doc-private", body: "# Private note", updatedAt: "2000-01-01T08:00:00Z" },
      { id: "doc-shared", body: "# Shared note", sharedAt: "2000-01-01T09:00:00Z", updatedAt: "2000-01-01T09:00:00Z" }
    ]);

    await renderWrite();
    await openDocumentFromSearch(/Private note/);
    const collection = screen.getByRole("combobox", { name: /Collection for/ });
    fireEvent.change(collection, { target: { value: "research" } });
    publishActiveDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true"));
    expect(collection).toHaveValue("research");
  });

  it("removes the shared state without leaving the editor", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-shared", body: "# Shared draft", shareToken: "share-token", sharedAt: "2026-07-09T08:00:00Z" }]);

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));
    expect(screen.getByRole("dialog", { name: "Share document" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-shared/share",
      expect.objectContaining({ method: "DELETE" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Make private" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("keeps collection assignment after a document is unshared", async () => {
    stubSignedInFetch([
      {
        id: "doc-shared",
        body: "# Shared note",
        shareToken: "share-token",
        sharedAt: "2000-01-01T08:00:00Z",
        updatedAt: "2000-01-01T08:00:00Z"
      },
      { id: "doc-private", body: "# Private note", updatedAt: "2000-01-01T09:00:00Z" }
    ]);

    await renderWrite();
    await openDocumentFromSearch(/Shared note/);
    const collection = screen.getByRole("combobox", { name: /Collection for/ });
    fireEvent.change(collection, { target: { value: "passage" } });
    makeActiveDocumentPrivate();

    await waitFor(() => expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false"));
    expect(collection).toHaveValue("passage");
  });

  it("uses document frontmatter as a collection signal without adding tag controls", async () => {
    await renderWrite();
    expect(screen.getByRole("combobox", { name: "Collection for Markdown for agents and humans" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Filter by tag" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Document tags" })).not.toBeInTheDocument();
  });

  it("keeps document row actions as native keyboard-reachable buttons", async () => {
    await renderWrite();

    const pin = screen.getByRole("button", { name: "Unstar document" });
    expect(pin.tagName).toBe("BUTTON");

    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    const remove = await screen.findByRole("button", { name: "Delete" });
    expect(remove.tagName).toBe("BUTTON");
  });

  it("does not show delete for shared documents", async () => {
    stubSignedInFetch([
      { id: "doc-1", body: "# Lead magnet", shareToken: "share-token" },
      { id: "doc-2", body: "# Prompt pack", sharedAt: "2026-07-02T12:00:00Z" }
    ]);

    await renderWrite();

    expect(screen.getAllByRole("heading", { name: "Lead magnet", level: 1 }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("still renders when browser storage reads are blocked", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    await renderWrite();

    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    getItem.mockRestore();
  });

  it("copies a server share link for the active document", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();

    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Shared draft\n\nReadable by link." }
    });
    publishActiveDocument();

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copiedUrl = writeText.mock.calls[0][0] as string;
    expect(copiedUrl).toBe("http://localhost:3000/d/public-2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("Public link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));
    expect(screen.getByRole("link", { name: "View public document" })).toHaveAttribute("href", "/d/public-2");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });

  it("blocks free users at the saved document limit", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-1", body: "# One" }]);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: freeAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && method === "GET") {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", body: "# One" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/collections" && method === "GET") {
        return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    await renderWrite();
    await createBlankDocument();

    expect(await screen.findByText("Free includes 1 saved documents. Upgrade for more.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("offers a reviewed limit increase when the Pro quota response blocks creation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "user-1", email: "writer@example.com" },
            account: { ...proAccount, usage: { savedDocs: 2000 } }
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && method === "GET") {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", body: "# One" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/docs" && method === "POST") {
        return new Response(JSON.stringify({ error: "saved document limit reached" }), { status: 402 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderWrite();
    await createBlankDocument();

    expect(await screen.findByText(/reached your 2,000 saved-document limit/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request more" })).toHaveAttribute("href", "/account#document-limit");
  });

  it("offers a reviewed limit increase in the editor before a Pro account reaches its limit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "user-1", email: "writer@example.com" },
            account: { ...proAccount, usage: { savedDocs: 1800 } }
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && method === "GET") {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", body: "# One" }] }), {
          status: 200
        });
      }
      if (url === "/api/v1/collections" && method === "GET") {
        return new Response(JSON.stringify({ collections: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderWrite();

    expect(screen.getByText("You're using 1,800 of 2,000 saved documents.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request more" })).toHaveAttribute("href", "/account#document-limit");
  });

  it("blocks sharing for free users", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-1", body: "# One" }]);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: freeAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && method === "GET") {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", body: "# One" }] }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByText("Sharing and raw .md URLs are Pro features.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-1/share",
      expect.objectContaining({ method: "POST" })
    );
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
    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: huge }
    });
    publishActiveDocument();

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

  it("keeps the sign-in action stable while the session check resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(<Login />);

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });

  it("keeps sign-in disabled until route revalidation finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 }))
    );

    render(
      <AuthProvider routeRevalidating>
        <Login />
      </AuthProvider>
    );

    await screen.findByText("Launch preview");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("signs in while public signup is closed without showing sign up", async () => {
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

    expect(await screen.findByText("Launch preview")).toBeInTheDocument();
    expect(screen.getByText("Public signup is not open yet. Existing account holders can sign in.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create a free account" })).not.toBeInTheDocument();
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

  it("links to free signup when the server enables it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            authenticated: false,
            publicSignupEnabled: true,
            policyVersion: "2026-07-31"
          }),
          { status: 200 }
        )
      )
    );

    render(<Login />);

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a free account" })).toHaveAttribute(
      "href",
      "/signup"
    );
  });

  it("signs out from the account menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
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

  it("keeps API token management on the account settings page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft" }] }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("writer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toHaveAttribute("href", "/account");
    expect(screen.queryByLabelText("API tokens")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create token" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/api-tokens", expect.anything());
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

    expect(await screen.findByRole("status", { name: "Redirecting to sign in" })).toBeInTheDocument();
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
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", body: "# Saved draft\n\nServer copy." }] }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderWrite();

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText("Loading saved docs")).not.toBeInTheDocument());
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs?limit=50", { credentials: "include" });
  });

  it("loads bounded metadata pages and fetches document bodies on demand", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50") {
        return new Response(
          JSON.stringify({
            documents: [{ id: "doc-1", publicId: "public-1", title: "First", excerpt: "First\n\nPreview" }],
            nextCursor: "page-two"
          }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50&cursor=page-two") {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-2", publicId: "public-2", title: "Second", excerpt: "Second" }] }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs/doc-1") {
        return new Response(JSON.stringify({ id: "doc-1", publicId: "public-1", body: "# First\n\nFull first body" }), {
          status: 200
        });
      }
      if (url === "/api/v1/docs/doc-2") {
        return new Response(JSON.stringify({ id: "doc-2", publicId: "public-2", body: "# Second\n\nFull second body" }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect((await screen.findAllByText("Full first body")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs?limit=50", { credentials: "include" });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1", { credentials: "include" });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/docs/doc-2", expect.anything());

    const second = await screen.findByRole("button", { name: /Second/ });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs?limit=50&cursor=page-two", { credentials: "include" });

    openWorkspaceSearch();
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents and tags" }), {
      target: { value: "Second" }
    });
    expect(second).toBeInTheDocument();

    fireEvent.click(second);
    expect((await screen.findAllByText("Full second body")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-2", { credentials: "include" });
    expect(screen.queryByRole("button", { name: "Load more documents" })).not.toBeInTheDocument();
  });

  it("preserves newer collection and star state when a slow body read finishes", async () => {
    let resolveBody: ((response: Response) => void) | undefined;
    let confirmedCollectionId: string | null = null;
    let confirmedCollectionSlug: string | null = null;
    let confirmedStarred = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50") {
        return new Response(JSON.stringify({
          documents: [{
            id: "doc-race",
            publicId: "public-race",
            title: "Race metadata",
            excerpt: "Race metadata\n\nPreview",
            updatedAt: "2026-08-15T08:00:00Z",
            collectionId: null,
            collectionSlug: null,
            starred: false
          }, {
            id: "doc-newer",
            publicId: "public-newer",
            title: "Newer metadata",
            excerpt: "Newer metadata",
            updatedAt: "2026-08-15T09:30:00Z",
            collectionId: null,
            collectionSlug: null,
            starred: false
          }]
        }), { status: 200 });
      }
      if (url === "/api/v1/docs/doc-race" && method === "GET") {
        return new Promise<Response>((resolve) => { resolveBody = resolve; });
      }
      if (url === "/api/v1/docs/doc-race" && method === "PATCH") {
        const update = JSON.parse(String(init?.body ?? "{}"));
        if (Object.prototype.hasOwnProperty.call(update, "collectionId")) {
          confirmedCollectionId = update.collectionId;
          confirmedCollectionSlug = update.collectionId ? "research" : null;
        }
        if (Object.prototype.hasOwnProperty.call(update, "starred")) confirmedStarred = update.starred;
        return new Response(JSON.stringify({
          id: "doc-race",
          publicId: "public-race",
          body: "# Race metadata\n\nFull body",
          collectionId: confirmedCollectionId,
          collectionSlug: confirmedCollectionSlug,
          starred: confirmedStarred,
          updatedAt: "2026-08-15T10:00:00Z"
        }), { status: 200 });
      }
      if (url === "/api/v1/collections") {
        return new Response(JSON.stringify({ collections: [{
          id: "collection-research",
          slug: "research",
          title: "Research",
          description: "Research notes.",
          createdAt: "2026-08-15T10:00:00Z",
          updatedAt: "2026-08-15T10:00:00Z"
        }] }), { status: 200 });
      }
      if (url === "/api/v1/templates") {
        return new Response(JSON.stringify({ templates: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);
    const open = await screen.findByRole("button", { name: /Race metadata.*Preview/ });
    fireEvent.click(open);
    const collection = await screen.findByRole("combobox");
    fireEvent.change(collection, { target: { value: "research" } });
    await waitFor(() => expect(collection).toHaveValue("research"));
    fireEvent.click(screen.getByRole("button", { name: "Star document" }));
    await screen.findByRole("button", { name: "Unstar document" });

    await act(async () => {
      resolveBody!(new Response(JSON.stringify({
        id: "doc-race",
        publicId: "public-race",
        body: "# Race metadata\n\nFull body",
        collectionId: null,
        collectionSlug: null,
        starred: false,
        updatedAt: "2026-08-15T09:00:00Z"
      }), { status: 200 }));
    });

    expect((await screen.findAllByText("Full body")).length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Collection for Race metadata" })).toHaveValue("research");
    expect(screen.getByRole("button", { name: "Unstar document" })).toBeEnabled();
    openWorkspaceHome();
    fireEvent.click(screen.getAllByRole("button", { name: "Recent" })[0]);
    const rows = screen.getByLabelText("Recent").querySelectorAll(".workspaceDocumentOpen");
    expect(rows[0]).toHaveTextContent("Race metadata");
    expect(rows[1]).toHaveTextContent("Newer metadata");
  });

  it("preserves newer metadata when an older body save finishes", async () => {
    const baseFetch = stubSignedInFetch([
      { id: "doc-old", body: "# Older note\n\nDraft.", updatedAt: "2026-08-15T08:00:00Z" },
      { id: "doc-new", body: "# Newer note", updatedAt: "2026-08-15T09:30:00Z" }
    ]);
    let resolveBodySave: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-old" && init?.method === "PATCH") {
        const update = JSON.parse(String(init.body ?? "{}"));
        if (Object.prototype.hasOwnProperty.call(update, "body")) {
          return new Promise<Response>((resolve) => { resolveBodySave = resolve; });
        }
        if (Object.prototype.hasOwnProperty.call(update, "starred")) {
          return Promise.resolve(new Response(JSON.stringify({
            id: "doc-old",
            publicId: "public-1",
            body: "# Older note\n\nEdited.",
            collectionId: null,
            collectionSlug: null,
            starred: true,
            updatedAt: "2026-08-15T10:00:00Z"
          }), { status: 200 }));
        }
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    await openDocumentFromSearch(/Older note/);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Older note\n\nEdited." }
    });
    await waitFor(() => expect(resolveBodySave).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Star document" }));
    await screen.findByRole("button", { name: "Unstar document" });

    await act(async () => {
      resolveBodySave!(new Response(JSON.stringify({
        id: "doc-old",
        publicId: "public-1",
        body: "# Older note\n\nEdited.",
        collectionId: null,
        collectionSlug: null,
        starred: false,
        updatedAt: "2026-08-15T09:00:00Z"
      }), { status: 200 }));
    });

    expect(screen.getByRole("button", { name: "Unstar document" })).toBeEnabled();
    openWorkspaceHome();
    fireEvent.click(screen.getAllByRole("button", { name: "Recent" })[0]);
    const rows = screen.getByLabelText("Recent").querySelectorAll(".workspaceDocumentOpen");
    expect(rows[0]).toHaveTextContent("Older note");
    expect(rows[1]).toHaveTextContent("Newer note");
  });

  it("lets users retry after a background document page fails", async () => {
    let laterPageRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50") {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", body: "# First" }], nextCursor: "page-two" }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50&cursor=page-two") {
        laterPageRequests += 1;
        if (laterPageRequests === 1) return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
        return new Response(JSON.stringify({ documents: [{ id: "doc-2", publicId: "public-2", body: "# Recovered document" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    const retry = await screen.findByRole("button", { name: "Load more documents" });
    expect(screen.getByText("Some documents could not be indexed. Load the next page to try again.")).toBeInTheDocument();
    fireEvent.click(retry);

    expect(await screen.findByRole("button", { name: /Recovered document/ })).toBeInTheDocument();
    expect(laterPageRequests).toBe(2);
    expect(screen.queryByRole("button", { name: "Load more documents" })).not.toBeInTheDocument();
  });

  it("keeps an unloaded document read-only after a body request fails", async () => {
    let bodyRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50") {
        return new Response(
          JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", title: "Important", excerpt: "Important" }] }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs/doc-1" && !init?.method) {
        bodyRequests += 1;
        if (bodyRequests === 1) {
          return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
        }
        return new Response(JSON.stringify({ id: "doc-1", publicId: "public-1", body: "# Important\n\nStill safe" }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/write/public-1");
    render(<Write />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Document could not be loaded.");
    expect(screen.queryByRole("textbox", { name: "Markdown editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect((await screen.findAllByText("Still safe")).length).toBeGreaterThan(0);
    expect(bodyRequests).toBe(2);
  });

  it("keeps a signed-in account empty when it has no documents", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
        return new Response(JSON.stringify({ documents: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
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
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
        return new Response(JSON.stringify({ documents: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Write />);

    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();
    expect(screen.queryByText("Local draft")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
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
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
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

    await renderWrite();

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

  it("keeps a pending edit when the same user session refreshes", async () => {
    let documentLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
        documentLoads += 1;
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

    await renderWrite(
      <AppProviders>
        <Write />
      </AppProviders>
    );

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Saved draft\n\nSurvives refresh." }
    });
    window.dispatchEvent(new Event("focus"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/docs/doc-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ body: "# Saved draft\n\nSurvives refresh." })
        })
      )
    );
    expect(documentLoads).toBe(1);
  });

  it("replaces documents and cancels a pending save when the active account changes", async () => {
    let sessionRequests = 0;
    let documentLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        const user = sessionRequests === 1
          ? { id: "user-1", email: "one@example.com" }
          : { id: "user-2", email: "two@example.com" };
        return new Response(JSON.stringify({ authenticated: true, user, account: proAccount }), { status: 200 });
      }
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
        documentLoads += 1;
        const documents = sessionRequests === 1
          ? [{ id: "doc-one", body: "# First account" }]
          : [{ id: "doc-two", body: "# Second account" }];
        return new Response(JSON.stringify({ documents }), { status: 200 });
      }
      if (url === "/api/v1/docs/doc-one" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: "doc-one", body: JSON.parse(String(init.body)).body }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderWrite(
      <AppProviders>
        <Write />
      </AppProviders>
    );

    expect(screen.getAllByRole("heading", { name: "First account", level: 1 }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# First account\n\nMust not cross accounts." }
    });

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(document.body).toHaveTextContent("Second account"));
    expect(document.body).not.toHaveTextContent("First account\n\nMust not cross accounts.");
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    expect(documentLoads).toBe(2);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-one",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("discards a delayed metadata page after the active account changes", async () => {
    let sessionRequests = 0;
    let resolveOldPage: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        const user = sessionRequests === 1
          ? { id: "user-1", email: "one@example.com" }
          : { id: "user-2", email: "two@example.com" };
        return new Response(JSON.stringify({ authenticated: true, user, account: proAccount }), { status: 200 });
      }
      if (url === "/api/v1/docs?limit=50") {
        const documents = sessionRequests === 1
          ? [{ id: "doc-one", body: "# First account" }]
          : [{ id: "doc-two", body: "# Second account" }];
        return new Response(
          JSON.stringify({ documents, nextCursor: sessionRequests === 1 ? "old-account-page" : undefined }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/docs?limit=50&cursor=old-account-page") {
        return new Promise<Response>((resolve) => {
          resolveOldPage = resolve;
        });
      }
      return new Response(JSON.stringify({ error: `unexpected request: ${url}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppProviders>
        <Write />
      </AppProviders>
    );

    expect(await screen.findByRole("button", { name: /First account/ })).toBeInTheDocument();
    await waitFor(() => expect(resolveOldPage).toBeDefined());

    window.dispatchEvent(new Event("focus"));

    expect(await screen.findByRole("button", { name: /Second account/ })).toBeInTheDocument();
    resolveOldPage?.(
      new Response(
        JSON.stringify({ documents: [{ id: "doc-private", title: "Private old account metadata", excerpt: "Private" }] }),
        { status: 200 }
      )
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.queryByText("Private old account metadata")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /First account/ })).not.toBeInTheDocument();
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
          JSON.stringify({
            authenticated: true,
            user: { id: "user-1", email: "writer@example.com" },
            account: proAccount
          }),
          { status: 200 }
        );
      }
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
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

    await renderWrite();

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    publishActiveDocument();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/d/${token}`));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1/share", {
      method: "POST",
      credentials: "include"
    });
    expect(await screen.findByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true");
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
      if (url.startsWith("/api/v1/docs?") && !init?.method) {
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

    await renderWrite();

    const shared = await screen.findByRole("button", { name: "Shared" });
    expect(shared).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(shared);
    fireEvent.click(screen.getByRole("button", { name: "Make private" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1/share", {
      method: "DELETE",
      credentials: "include"
    });
  });
});
