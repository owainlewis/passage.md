import { act, fireEvent, render as renderBare, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import Account from "./account/page";
import { AppProviders } from "./app-providers";
import { ThemeProvider } from "./theme";
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
  version?: number;
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
    if (url.startsWith("/api/v1/docs/") && url.endsWith("/share") && method === "DELETE") {
      return new Response(null, { status: 204 });
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

// The real app mounts every route inside AppProviders, which supplies the
// theme. Route components are rendered bare here, so wrap them the same way.
function render(ui: ReactNode) {
  return renderBare(<ThemeProvider>{ui}</ThemeProvider>);
}

async function renderWrite(ui: ReactNode = <Write />) {
  const view = render(ui);
  await screen.findByRole("region", { name: "Markdown editor" });
  await waitFor(() => expect(screen.queryByRole("status", { name: "Opening your writing" })).not.toBeInTheDocument());
  return view;
}

function openDrawer() {
  const toggle = screen.getByRole("button", { name: "Documents" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return screen.getByRole("navigation", { name: "All documents" });
}

async function openDocumentNamed(title: string) {
  fireEvent.click(within(openDrawer()).getByRole("button", { name: new RegExp(`^${title}`) }));
  await screen.findByRole("region", { name: "Markdown editor" });
}

function newDocumentButton() {
  return screen.getByRole("button", { name: "New document" });
}

function showSource() {
  if (!screen.queryByRole("textbox", { name: "Markdown editor" })) {
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
  }
}

// The new-document control creates a blank page directly. Callers that expect
// it to succeed wait for the editor themselves; creation can also be refused,
// for example at a saved-document limit.
async function createBlankDocument() {
  fireEvent.click(newDocumentButton());
  await waitFor(() => expect(newDocumentButton()).toBeEnabled());
  // These API/save tests enter exact Markdown. Visual editing is tested separately.
  showSource();
}

function openWorkspaceSearch() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

async function openDocumentFromSearch(name: string | RegExp) {
  openWorkspaceSearch();
  const list = screen.getByRole("navigation", { name: "All documents" });
  fireEvent.click(await within(list).findByRole("button", { name }));
  await screen.findByRole("region", { name: "Markdown editor" });
}

function openDocumentAction(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

function deleteActiveDocument() {
  openDocumentAction("Delete");
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete document" })).getByRole("button", { name: "Delete" }));
}

function publishActiveDocument() {
  openDocumentAction("Share…");
  fireEvent.click(screen.getByRole("button", { name: "Create link" }));
}

function makeActiveDocumentPrivate() {
  openDocumentAction("Sharing settings…");
  fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
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
  it("pitches quiet writing, current pricing, and account actions for Pro users", async () => {
    render(<Landing />);

    expect(screen.getByRole("heading", { name: "A quiet place to write." })).toBeInTheDocument();
    expect(screen.getByText(/a Markdown editor with nothing in the way/)).toBeInTheDocument();
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
    for (const name of ["Nothing in the way", "Find anything", "Plain Markdown", "Your agents can read it too."]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("list", { name: "Keyboard shortcuts" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Read the CLI guide" })).toHaveAttribute("href", "/cli");
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

    expect(await screen.findByRole("button", { name: /^Retried session/ , hidden: true })).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: /^Recovered session/ , hidden: true })).toBeInTheDocument();
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

    expect(await screen.findByRole("status", { name: "Opening your writing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    expect(screen.queryByText("Markdown for agents and humans")).not.toBeInTheDocument();

    await waitFor(() => expect(resolveDocs).toBeDefined());
    resolveDocs?.(
      new Response(JSON.stringify({ documents: [{ id: "doc-notes", publicId: "notes-public-id", body: "# Agent notes" }] }), {
        status: 200
      })
    );

    expect(await screen.findByRole("button", { name: /^Agent notes/ , hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("Markdown for agents and humans")).not.toBeInTheDocument();
  });

  it("sends the loaded version with autosave and keeps the draft when the server refuses it", async () => {
    const patches: string[] = [];
    const baseFetch = stubSignedInFetch([{ id: "doc-shared", publicId: "shared", body: "# Shared", version: 2 }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-shared" && init?.method === "PATCH") {
        patches.push(String(init?.body ?? ""));
        return Promise.resolve(new Response(JSON.stringify({
          error: "document changed since it was loaded",
          document: {
              id: "doc-shared",
              publicId: "shared",
              body: "# Shared\n\nwritten by an agent",
              version: 3,
              starred: false,
              collectionId: null,
              collectionSlug: null,
              updatedAt: "2026-08-16T12:00:00Z"
            }
        }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    showSource();
    fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Shared\n\nwritten in the browser" }
    });

    const conflict = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(conflict).toHaveTextContent("This document changed somewhere else");

    // The save carried the version this editor loaded.
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0])).toMatchObject({ version: 2 });

    // The draft survives, and the writer is offered a choice rather than overruled.
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Shared\n\nwritten in the browser");
    expect(within(conflict).getByRole("button", { name: "Discard mine, load theirs" })).toBeInTheDocument();
    expect(within(conflict).getByRole("button", { name: "Keep mine, overwrite theirs" })).toBeInTheDocument();

    // Nothing retried on its own.
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(patches).toHaveLength(1);
  });

  it("keeps typing through an in-flight save without inventing a conflict", async () => {
    const versions: (number | undefined)[] = [];
    let releaseFirst: (() => void) | undefined;
    let version = 2;
    const baseFetch = stubSignedInFetch([{ id: "doc-shared", publicId: "shared", body: "# Shared", version: 2 }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-shared" && init?.method === "PATCH") {
        const sent = JSON.parse(String(init?.body ?? "{}"));
        versions.push(sent.version);
        if (sent.version !== version) {
          return Promise.resolve(new Response(JSON.stringify({
            error: "document changed since it was loaded",
            document: { id: "doc-shared", publicId: "shared", body: "# Shared", version, starred: false, collectionId: null, collectionSlug: null, updatedAt: "2026-08-17T12:00:00Z" }
          }), { status: 409, headers: { "Content-Type": "application/json" } }));
        }
        version += 1;
        const payload = new Response(JSON.stringify({
          id: "doc-shared", publicId: "shared", body: sent.body, version,
          starred: false, collectionId: null, collectionSlug: null, updatedAt: "2026-08-17T12:00:00Z"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
        // Hold the first response open so the next keystroke lands while it is
        // still in flight. That is the ordinary case: typing does not stop for
        // the network.
        if (!releaseFirst) {
          return new Promise<Response>((resolve) => { releaseFirst = () => resolve(payload); });
        }
        return Promise.resolve(payload);
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    showSource();
    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });

    fireEvent.change(editor, { target: { value: "# Shared\n\nfirst" } });
    await waitFor(() => expect(releaseFirst).toBeDefined());

    fireEvent.change(editor, { target: { value: "# Shared\n\nfirst second" } });
    releaseFirst!();

    await waitFor(() => expect(versions.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    // The second save must carry the version the first one produced. Sending
    // the stale one turns ordinary typing into a conflict.
    expect(versions[0]).toBe(2);
    expect(versions[1]).toBe(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(editor).toHaveValue("# Shared\n\nfirst second");
  });

  it("loads the newer version when the writer discards their draft", async () => {
    const baseFetch = stubSignedInFetch([{ id: "doc-shared", publicId: "shared", body: "# Shared", version: 2 }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-shared" && init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({
          error: "document changed since it was loaded",
          document: {
              id: "doc-shared",
              publicId: "shared",
              body: "# Shared\n\nwritten by an agent",
              version: 3,
              starred: false,
              collectionId: null,
              collectionSlug: null,
              updatedAt: "2026-08-16T12:00:00Z"
            }
        }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    showSource();
    fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Shared\n\nwritten in the browser" }
    });

    fireEvent.click(await screen.findByRole("button", { name: "Discard mine, load theirs" }, { timeout: 3000 }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Shared\n\nwritten by an agent")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retries against the newer version when the writer keeps their draft", async () => {
    const patches: string[] = [];
    let conflicted = false;
    const baseFetch = stubSignedInFetch([{ id: "doc-shared", publicId: "shared", body: "# Shared", version: 2 }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-shared" && init?.method === "PATCH") {
        patches.push(String(init?.body ?? ""));
        if (!conflicted) {
          conflicted = true;
          return Promise.resolve(new Response(JSON.stringify({
            error: "document changed since it was loaded",
            document: {
              id: "doc-shared",
              publicId: "shared",
              body: "# Shared\n\nwritten by an agent",
              version: 3,
              starred: false,
              collectionId: null,
              collectionSlug: null,
              updatedAt: "2026-08-16T12:00:00Z"
            }
          }), { status: 409, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: "doc-shared",
          publicId: "shared",
          body: JSON.parse(String(init?.body ?? "{}")).body,
          version: 4,
          starred: false,
          collectionId: null,
          collectionSlug: null,
          updatedAt: "2026-08-16T12:01:00Z"
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    showSource();
    fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Shared\n\nwritten in the browser" }
    });

    fireEvent.click(await screen.findByRole("button", { name: "Keep mine, overwrite theirs" }, { timeout: 3000 }));

    // The overwrite goes out against the version the server reported, so it is
    // a deliberate replacement rather than a replay of the refused request.
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(JSON.parse(patches[1])).toMatchObject({ version: 3, body: "# Shared\n\nwritten in the browser" });
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Shared\n\nwritten in the browser");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("overwrites with what is on screen now, not what was there when the save was refused", async () => {
    const patches: string[] = [];
    let conflicted = false;
    const baseFetch = stubSignedInFetch([{ id: "doc-shared", publicId: "shared", body: "# Shared", version: 2 }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs/doc-shared" && init?.method === "PATCH") {
        patches.push(String(init?.body ?? ""));
        if (!conflicted) {
          conflicted = true;
          return Promise.resolve(new Response(JSON.stringify({
            error: "document changed since it was loaded",
            document: {
              id: "doc-shared",
              publicId: "shared",
              body: "# Shared\n\nwritten by an agent",
              version: 3,
              starred: false,
              collectionId: null,
              collectionSlug: null,
              updatedAt: "2026-08-16T12:00:00Z"
            }
          }), { status: 409, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          id: "doc-shared",
          publicId: "shared",
          body: JSON.parse(String(init?.body ?? "{}")).body,
          version: 4,
          starred: false,
          collectionId: null,
          collectionSlug: null,
          updatedAt: "2026-08-16T12:01:00Z"
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    showSource();
    const editor = await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(editor, { target: { value: "# Shared\n\nfirst draft" } });

    const overwrite = await screen.findByRole("button", { name: "Keep mine, overwrite theirs" }, { timeout: 3000 });

    // Still typing while the banner is up.
    fireEvent.change(editor, { target: { value: "# Shared\n\nfirst draft, then more" } });
    fireEvent.click(overwrite);

    await waitFor(() => expect(patches.length).toBeGreaterThanOrEqual(2));
    expect(JSON.parse(patches[patches.length - 1])).toMatchObject({ body: "# Shared\n\nfirst draft, then more" });
  });

  it("keeps an unresolved conflict on one document when another conflicts too", async () => {
    const baseFetch = stubSignedInFetch([
      { id: "doc-one", publicId: "one", body: "# One", version: 2 },
      { id: "doc-two", publicId: "two", body: "# Two", version: 2 }
    ]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/v1/docs/doc-") && init?.method === "PATCH") {
        const id = url.split("/").pop()!;
        return Promise.resolve(new Response(JSON.stringify({
          error: "document changed since it was loaded",
          document: {
            id,
            publicId: id === "doc-one" ? "one" : "two",
            body: `# ${id} from an agent`,
            version: 3,
            starred: false,
            collectionId: null,
            collectionSlug: null,
            updatedAt: "2026-08-16T12:00:00Z"
          }
        }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      return baseFetch(input, init);
    }));

    await renderWrite();
    showSource();
    fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# One\n\nmy words" }
    });
    await screen.findByRole("alert", {}, { timeout: 3000 });

    // Conflict the second document too.
    fireEvent.click(within(openDrawer()).getByRole("button", { name: /^Two/ , hidden: true }));
    showSource();
    fireEvent.change(await screen.findByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Two\n\nmy other words" }
    });
    await screen.findByRole("alert", {}, { timeout: 3000 });

    // The first document's conflict is still waiting, with its draft intact.
    fireEvent.click(within(openDrawer()).getByRole("button", { name: /^One/ , hidden: true }));
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("This document changed somewhere else");
    showSource();
    expect(await screen.findByRole("textbox", { name: "Markdown editor" })).toHaveValue("# One\n\nmy words");
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
    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), {
      target: { value: "roadmap" }
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /Launch note/ })).toHaveTextContent("Roadmap coverage"));
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

    expect((await screen.findAllByRole("heading", { name: "Agent notes", level: 1 })).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe("/write/notes-public-id");
  });

  it("restores a document when browser history returns to its stable URL", async () => {
    stubSignedInFetch([{ id: "doc-notes", publicId: "notes-public-id", body: "# Agent notes\n\nFollow ups." }]);

    await renderWrite();
    act(() => {
      window.history.pushState(null, "", "/write/notes-public-id");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
    expect((await screen.findAllByRole("heading", { name: "Agent notes", level: 1 })).length).toBeGreaterThan(0);
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

  it("recovers a stale document URL without showing another document under it", async () => {
    stubSignedInFetch([{ id: "doc-current", publicId: "current", body: "# Current note" }]);
    window.history.replaceState(null, "", "/write/stale");

    render(<Write />);

    expect(await screen.findByText("That document could not be found.")).toBeInTheDocument();
    expect((await screen.findAllByRole("heading", { name: "Current note", level: 1 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(window.location.pathname).toBe("/write/current"));
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
    openDocumentAction("Delete");

    expect(screen.getByRole("dialog", { name: "Delete document" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-private",
      expect.objectContaining({ method: "DELETE" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete document" })).not.toBeInTheDocument();
    expect((await screen.findAllByRole("heading", { name: "Private note", level: 1 })).length).toBeGreaterThan(0);
  });

  it("closes document confirmations when history changes the active document", async () => {
    const fetchMock = stubSignedInFetch([
      { id: "doc-first", publicId: "first", body: "# First note" },
      { id: "doc-second", publicId: "second", body: "# Second note", shareToken: "second", sharedAt: "2026-08-15T12:00:00Z" }
    ]);

    await renderWrite();
    openDocumentAction("Delete");
    expect(screen.getByRole("dialog", { name: "Delete document" })).toBeInTheDocument();

    act(() => {
      window.history.pushState(null, "", "/write/second");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((await screen.findAllByRole("heading", { name: "Second note", level: 1 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Delete document" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).startsWith("/api/v1/docs/") && init?.method === "DELETE")).toBe(false);

    openDocumentAction("Sharing settings…");
    expect(screen.getByRole("dialog", { name: "Share document" })).toBeInTheDocument();
    act(() => {
      window.history.pushState(null, "", "/write/first");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((await screen.findAllByRole("heading", { name: "First note", level: 1 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Share document" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-second/share",
      expect.objectContaining({ method: "DELETE" })
    );

    openDocumentAction("Share…");
    act(() => {
      window.history.pushState(null, "", "/write/second");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((await screen.findAllByRole("heading", { name: "Second note", level: 1 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Share document" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-first/share",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("deletes the final document and returns to Home", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-only", body: "# Only note\n\nDraft." }]);

    const { unmount } = await renderWrite();

    deleteActiveDocument();

    expect(await screen.findByRole("heading", { name: "A blank page." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Only note/ })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/write");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-only", {
      method: "DELETE",
      credentials: "include"
    });

    unmount();
    render(<Write />);

    expect(await screen.findByRole("heading", { name: "A blank page." })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("cancels a pending autosave when deleting its document", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-only", body: "# Only note\n\nDraft." }]);

    await renderWrite();
    showSource();
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
    showSource();
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

  it("marks a document as shared without leaving the editor", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fetchMock = stubSignedInFetch();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();
    openDocumentAction("Share…");
    expect(screen.getByRole("dialog", { name: "Share document" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-welcome/share",
      expect.objectContaining({ method: "POST" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await screen.findByText("Shared", { selector: ".wFooter span" });
    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("removes the shared state without leaving the editor", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-shared", body: "# Shared draft", shareToken: "share-token", sharedAt: "2026-07-09T08:00:00Z" }]);

    await renderWrite();
    openDocumentAction("Sharing settings…");
    expect(screen.getByRole("dialog", { name: "Share document" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs/doc-shared/share",
      expect.objectContaining({ method: "DELETE" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    await waitFor(() => expect(screen.queryByText("Shared", { selector: ".wFooter span" })).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
  });

  it("does not show delete for shared documents", async () => {
    stubSignedInFetch([
      { id: "doc-1", body: "# Lead magnet", shareToken: "share-token" },
      { id: "doc-2", body: "# Prompt pack", sharedAt: "2026-07-02T12:00:00Z" }
    ]);

    await renderWrite();

    expect((await screen.findAllByRole("heading", { name: "Lead magnet", level: 1 })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
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

  it("creates one document however fast the control is pressed", async () => {
    let creates = 0;
    const baseFetch = stubSignedInFetch([{ id: "doc-1", publicId: "one", body: "# Existing" }]);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/docs" && init?.method === "POST") creates += 1;
      return baseFetch(input, init);
    }));

    await renderWrite();
    const button = newDocumentButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await screen.findByRole("textbox", { name: "Visual editor" });
    await waitFor(() => expect(newDocumentButton()).toBeEnabled());
    expect(creates).toBe(1);
  });

  it("copies the document Markdown from the editor", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    stubSignedInFetch([{ id: "doc-1", publicId: "one", body: "# Notes\n\nExact Markdown." }]);

    await renderWrite();
    openDocumentAction("Copy Markdown");

    // The Markdown itself, byte for byte, not a rendered version of it.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("# Notes\n\nExact Markdown."));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
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
    // The action menu keeps the link reachable after publishing.
    await screen.findByText("Shared", { selector: ".wFooter span" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Document actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy share link" })).toBeInTheDocument();

    // Copying from the menu needs no dialog and no republishing.
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy share link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toBe("http://localhost:3000/d/public-2");

    // The dialog shows the URL rather than only linking to it.
    openDocumentAction("Sharing settings…");
    expect(await screen.findByText("http://localhost:3000/d/public-2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/d/public-2");
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
    openDocumentAction("Share…");

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

  it("chooses the theme from settings, for every user", async () => {
    render(<Account />);

    const themes = await screen.findByRole("radiogroup", { name: "Theme" });
    const dark = within(themes).getByRole("radio", { name: /Dark/ });
    const light = within(themes).getByRole("radio", { name: /Light/ });
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(dark).not.toBeDisabled();
    expect(screen.queryByText("Dark mode is a Pro feature.")).not.toBeInTheDocument();

    fireEvent.click(dark);
    expect(document.documentElement.dataset.themeTransitionBlocked).toBe("true");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(localStorage.getItem("passage.theme.v1")).toBe("dark");
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(light).toHaveAttribute("aria-checked", "false");

    fireEvent.click(light);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
    expect(localStorage.getItem("passage.theme.v1")).toBe("light");
  });

  it("carries a saved dark theme into the editor without a sidebar control", async () => {
    localStorage.setItem("passage.theme.v1", "dark");
    await renderWrite();

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.queryByRole("switch", { name: "Dark mode" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("menuitem", { name: "Light mode" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/account");
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
    expect(within(await screen.findByRole("menu")).getByText("writer@example.com")).toBeInTheDocument();
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
    const accountMenu = await screen.findByRole("menu");
    expect(within(accountMenu).getByText("writer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/account");
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

    const second = await screen.findByRole("button", { name: /^Second/ , hidden: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs?limit=50&cursor=page-two", { credentials: "include" });

    openWorkspaceSearch();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), {
      target: { value: "Second" }
    });
    expect(second).toBeInTheDocument();

    fireEvent.click(second);
    expect((await screen.findAllByText("Full second body")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-2", { credentials: "include" });
    expect(screen.queryByRole("button", { name: "Load more documents" })).not.toBeInTheDocument();
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

    await screen.findByText("Some documents could not be indexed. Load the next page to try again.");
    openDrawer();
    const retry = await screen.findByRole("button", { name: "Load more documents" });
    expect(screen.getByText("Some documents could not be indexed. Load the next page to try again.")).toBeInTheDocument();
    fireEvent.click(retry);

    expect(await screen.findByRole("button", { name: /^Recovered document/ , hidden: true })).toBeInTheDocument();
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

    expect(await screen.findByRole("alert")).toHaveTextContent("This document could not be opened.");
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
    showSource();
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
    showSource();
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

    expect((await screen.findAllByRole("heading", { name: "First account", level: 1 })).length).toBeGreaterThan(0);
    showSource();
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

    expect(await screen.findByRole("button", { name: /^First account/ , hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(resolveOldPage).toBeDefined());

    window.dispatchEvent(new Event("focus"));

    expect(await screen.findByRole("button", { name: /^Second account/ , hidden: true })).toBeInTheDocument();
    resolveOldPage?.(
      new Response(
        JSON.stringify({ documents: [{ id: "doc-private", title: "Private old account metadata", excerpt: "Private" }] }),
        { status: 200 }
      )
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.queryByText("Private old account metadata")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^First account/ , hidden: true })).not.toBeInTheDocument();
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
    expect(await screen.findByText("Shared", { selector: ".wFooter span" })).toBeInTheDocument();
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

    await screen.findByText("Shared", { selector: ".wFooter span" });
    makeActiveDocumentPrivate();

    await waitFor(() => expect(screen.queryByText("Shared", { selector: ".wFooter span" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1/share", {
      method: "DELETE",
      credentials: "include"
    });
  });
});

describe("visual writing and collection navigation", () => {
  it("does not save on opening or switching modes", async () => {
    const original = "---\ntags: [writing]\n---\n\n# A draft\n\nSome **text**.\n";
    const fetchMock = stubSignedInFetch([{ id: "visual", publicId: "visual", body: original }]);
    await renderWrite();
    await screen.findByRole("textbox", { name: "Visual editor" });
    showSource();
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue(original);
    showSource();
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    await screen.findByRole("textbox", { name: "Visual editor" });
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });

});

describe("Writer", () => {
  it("lists every document newest first, with no folders, stars, or templates", async () => {
    stubSignedInFetch([
      { id: "doc-old", publicId: "old", body: "# Older idea", updatedAt: "2026-08-01T10:00:00Z", collectionSlug: "research" },
      { id: "doc-new", publicId: "new", body: "# Newest draft", updatedAt: "2026-08-03T10:00:00Z" },
      { id: "doc-mid", publicId: "mid", body: "# Middle note", updatedAt: "2026-08-02T10:00:00Z", starred: true }
    ]);
    await renderWrite();

    const rows = within(openDrawer()).getAllByRole("button").filter((row) => row.classList.contains("wDocRow"));
    expect(rows.map((row) => row.querySelector(".wDocTitle")?.textContent)).toEqual(["Newest draft", "Middle note", "Older idea"]);
    for (const retired of ["Collections", "Starred", "Templates", "Home", "Recent", "Share", "Write", "Preview"]) {
      expect(screen.queryByRole("button", { name: retired })).not.toBeInTheDocument();
    }
  });

  it("lands retired workspace links on the writer", async () => {
    stubSignedInFetch([{ id: "doc-1", publicId: "one", body: "# Only note" }]);
    window.history.replaceState(null, "", "/write?view=templates");

    await renderWrite();

    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/write/one"));
  });

  it("opens search with the keyboard and opens the highlighted result with Enter", async () => {
    stubSignedInFetch([
      { id: "doc-1", publicId: "one", body: "# Grocery list\n\nEggs." },
      { id: "doc-2", publicId: "two", body: "# Talk outline\n\nCalm software." }
    ]);
    await renderWrite();

    openWorkspaceSearch();
    const search = screen.getByRole("searchbox", { name: "Search documents" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "calm" } });
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "All documents" })).getAllByRole("button")).toHaveLength(1));
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(window.location.pathname).toBe("/write/two"));
  });

  it("shows the Markdown source with the keyboard and goes back", async () => {
    stubSignedInFetch([{ id: "doc-1", publicId: "one", body: "# Plain\n\n- one\n- two\n" }]);
    await renderWrite();
    await screen.findByRole("textbox", { name: "Visual editor" });

    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Plain\n\n- one\n- two\n");
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(await screen.findByRole("textbox", { name: "Visual editor" })).toBeInTheDocument();
  });

  it("steps the chrome back while typing and brings it back on pointer movement", async () => {
    stubSignedInFetch([{ id: "doc-1", publicId: "one", body: "# Quiet" }]);
    const { container } = await renderWrite();
    showSource();
    const writer = container.querySelector<HTMLElement>(".writer")!;

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Markdown editor" }), { key: "a" });
    expect(writer.dataset.typing).toBe("true");

    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    expect(writer.dataset.typing).toBeUndefined();
  });

  it("creates a blank document straight into the editor", async () => {
    stubSignedInFetch([{ id: "doc-1", publicId: "one", body: "# Existing" }]);
    await renderWrite();

    fireEvent.click(newDocumentButton());

    const editor = await waitFor(() => {
      const input = screen.getByRole("textbox", { name: "Visual editor" });
      expect(input.textContent).toBe("");
      return input;
    });
    await waitFor(() => expect(editor).toHaveFocus());
    expect(window.location.pathname).toBe("/write/public-2");
  });
});
