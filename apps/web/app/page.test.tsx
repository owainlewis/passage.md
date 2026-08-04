import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  let templates: Array<{ id: string; title: string; body: string; createdAt: string; updatedAt: string }> = [];
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
      return new Response(JSON.stringify({ documents: docs }), { status: 200 });
    }
    if (url === "/api/v1/templates" && method === "GET") {
      return new Response(JSON.stringify({ templates }), { status: 200 });
    }
    if (url === "/api/v1/templates" && method === "POST") {
      const input = JSON.parse(String(init?.body ?? "{}"));
      const template = {
        id: `template-${templates.length + 1}`,
        title: input.title,
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
  const view = render(<Write />);
  await screen.findByRole("region", { name: "Markdown editor" });
  await waitFor(() => expect(screen.queryByRole("status", { name: "Loading saved docs" })).not.toBeInTheDocument());
  return view;
}

async function createBlankDocument() {
  fireEvent.click(screen.getByRole("button", { name: "New document" }));
  fireEvent.click(await screen.findByRole("button", { name: "Create blank document" }));
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
  it("shows the product loop, current pricing, and account actions for Pro users", async () => {
    render(<Landing />);

    expect(screen.getByText("Markdown writing for agents and humans")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "One document. Three useful surfaces." })).toBeInTheDocument();
    expect(screen.getAllByText("passage cat <doc-id>").length).toBeGreaterThan(0);
    expect(screen.getByText("$5")).toHaveTextContent("$5 USD / month");
    expect(screen.getByText("Save thousands of documents")).toBeInTheDocument();
    expect(screen.getByText(/Renews monthly until cancelled/)).toBeInTheDocument();
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
    expect(screen.getByText(/Unshare revokes both URLs/)).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "passage.md home" })).toHaveAttribute("href", "/write");
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
    expect(screen.getByRole("region", { name: "Markdown editor" })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "Create a document" })).toBeInTheDocument();
    expect(screen.queryByText("Library")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    const title = await screen.findByRole("textbox", { name: "Template title" });
    fireEvent.change(title, { target: { value: "YouTube script" } });
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
            body: "# [Video title]\n\n## Opening\n\nWrite the hook."
          })
        })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));
    expect(await screen.findByRole("heading", { name: "YouTube script" })).toBeInTheDocument();
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

  it("deletes a template and frees its library slot", async () => {
    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    await screen.findByRole("textbox", { name: "Template title" });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("0 of 10 templates")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Template title" })).not.toBeInTheDocument();
  });

  it("filters the document list by title and body text", async () => {
    await renderWrite();

    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Launch note\n\nRoadmap coverage." }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Search documents and tags" }), {
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

    fireEvent.change(screen.getByRole("textbox", { name: "Search documents and tags" }), {
      target: { value: "scripts" }
    });

    expect(screen.getByRole("button", { name: /Video script/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agent notes/ })).not.toBeInTheDocument();
  });

  it("filters the document list by typing in the tag filter", async () => {
    stubSignedInFetch([
      { id: "doc-notes", body: "---\ntags: [notes]\n---\n\n# Agent notes\n\nFollow ups." },
      { id: "doc-scripts", body: "---\ntags: [scripts]\n---\n\n# Video script\n\nOpening line." }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Agent notes/ });

    fireEvent.change(screen.getByRole("textbox", { name: "Filter by tag" }), {
      target: { value: "script" }
    });

    expect(screen.getByRole("button", { name: /Video script/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agent notes/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("button", { name: /Agent notes/ })).toBeInTheDocument();
  });

  it("shows one flat document list and filters by sharing state", async () => {
    stubSignedInFetch([
      { id: "doc-private", body: "# Private note\n\nDraft." },
      { id: "doc-shared", body: "# Shared note\n\nPublished.", sharedAt: "2026-07-09T08:00:00Z" }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    const sharingFilter = screen.getByRole("combobox", { name: "Filter documents by sharing" });
    expect(sharingFilter).toHaveValue("all");
    expect(screen.queryByText("Folders")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Private note/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Shared note/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Shared document")).toBeInTheDocument();

    fireEvent.change(sharingFilter, { target: { value: "shared" } });

    expect(sharingFilter).toHaveValue("shared");
    expect(screen.getByRole("button", { name: /Shared note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Private note/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Shared note", level: 1 }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Published.").length).toBeGreaterThan(0);
  });

  it("clears the typed tag filter when changing the sharing filter", async () => {
    stubSignedInFetch([
      { id: "doc-private", body: "---\ntags: [notes]\n---\n\n# Private note\n\nDraft." },
      { id: "doc-shared", body: "---\ntags: [published]\n---\n\n# Shared note\n\nPublished.", sharedAt: "2026-07-09T08:00:00Z" }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    fireEvent.change(screen.getByRole("textbox", { name: "Filter by tag" }), {
      target: { value: "notes" }
    });

    expect(screen.getByRole("button", { name: /Private note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Shared note/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter documents by sharing" }), {
      target: { value: "shared" }
    });

    expect(screen.getByRole("textbox", { name: "Filter by tag" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /Shared note/ })).toBeInTheDocument();
  });

  it("allows an empty sharing filter without restoring folder sections", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    const sharingFilter = screen.getByRole("combobox", { name: "Filter documents by sharing" });
    fireEvent.change(sharingFilter, { target: { value: "shared" } });

    expect(sharingFilter).toHaveValue("shared");
    expect(screen.queryByRole("button", { name: /Private note/ })).not.toBeInTheDocument();
    expect(screen.getByText("No documents match.")).toBeInTheDocument();
    expect(screen.queryByText("Folders")).not.toBeInTheDocument();
  });

  it("returns to All after deleting the last document in a sharing filter", async () => {
    stubSignedInFetch([
      { id: "doc-private", body: "# Private note\n\nDraft." },
      { id: "doc-shared", body: "# Shared note\n\nPublished.", sharedAt: "2026-07-09T08:00:00Z" }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    const sharingFilter = screen.getByRole("combobox", { name: "Filter documents by sharing" });
    fireEvent.change(sharingFilter, { target: { value: "private" } });

    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));

    await waitFor(() => expect(sharingFilter).toHaveValue("all"));
    expect(screen.getByRole("button", { name: /Shared note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Private note/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Shared note", level: 1 }).length).toBeGreaterThan(0);
  });

  it("deletes the final document and shows an empty state", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-only", body: "# Only note\n\nDraft." }]);

    const { unmount } = await renderWrite();
    await screen.findByRole("button", { name: /Only note/ });

    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));

    await waitFor(() => expect(screen.getByText("No documents yet.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Only note/ })).not.toBeInTheDocument();
    expect(screen.getByText("No documents.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create document" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/write");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-only", {
      method: "DELETE",
      credentials: "include"
    });

    unmount();
    render(<Write />);

    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("cancels a pending autosave when deleting its document", async () => {
    const fetchMock = stubSignedInFetch([{ id: "doc-only", body: "# Only note\n\nDraft." }]);

    await renderWrite();
    await screen.findByRole("button", { name: /Only note/ });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# Edited note\n\nUnsaved." }
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));

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
    await screen.findByRole("button", { name: /First note/ });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# First edit\n\nUnsaved." }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete document" })[0]);

    fireEvent.click(screen.getByRole("button", { name: /Second note/ }));
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

  it("orders documents by latest with pinned documents first", async () => {
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
    await screen.findByRole("button", { name: /Pinned note/ });

    const rows = screen.getAllByRole("button", { name: /note/ }).map((button) => button.textContent ?? "");
    expect(rows[0]).toContain("Pinned note");
    expect(rows[1]).toContain("Latest note");
    expect(rows[2]).toContain("Old note");
  });

  it("marks a document as shared without moving it to another section", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();
    await screen.findByRole("button", { name: /Markdown for agents and humans/ });

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(screen.getByLabelText("Shared document")).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Filter documents by sharing" })).toHaveValue("all");
    expect(await screen.findByRole("button", { name: /Markdown for agents and humans/ })).toBeInTheDocument();
  });

  it("orders a newly shared document as latest in the flat list", async () => {
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
    await screen.findByRole("button", { name: /Private note/ });

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(screen.getByLabelText("Shared document")).toBeInTheDocument());
    const rows = screen.getAllByRole("button", { name: /note/ }).map((button) => button.textContent ?? "");
    expect(rows[0]).toContain("Private note");
    expect(rows[1]).toContain("Shared note");
  });

  it("removes the shared marker without moving the document", async () => {
    stubSignedInFetch([{ id: "doc-shared", body: "# Shared draft", shareToken: "share-token", sharedAt: "2026-07-09T08:00:00Z" }]);

    await renderWrite();
    await screen.findByRole("button", { name: /Shared draft/ });

    expect(screen.getByLabelText("Shared document")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));

    await waitFor(() => expect(screen.queryByLabelText("Shared document")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Filter documents by sharing" })).toHaveValue("all");
    expect(screen.getByRole("button", { name: /Shared draft/ })).toBeInTheDocument();
  });

  it("orders a newly unshared document as latest in the flat list", async () => {
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
    await screen.findByRole("button", { name: /Shared note/ });

    fireEvent.click(screen.getByRole("button", { name: "Shared" }));

    await waitFor(() => expect(screen.queryByLabelText("Shared document")).not.toBeInTheDocument());
    const rows = screen.getAllByRole("button", { name: /note/ }).map((button) => button.textContent ?? "");
    expect(rows[0]).toContain("Shared note");
    expect(rows[1]).toContain("Private note");
  });

  it("keeps the footer tag control filter-only", async () => {
    await renderWrite();
    await screen.findByRole("button", { name: /Markdown for agents and humans/ });

    expect(screen.getByRole("textbox", { name: "Filter by tag" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Document tags" })).not.toBeInTheDocument();
  });

  it("keeps document row actions as native keyboard-reachable buttons", async () => {
    await renderWrite();

    const pin = screen.getByRole("button", { name: "Unpin document" });
    expect(pin.tagName).toBe("BUTTON");

    await createBlankDocument();
    await screen.findByRole("textbox", { name: "Markdown editor" });
    const remove = await screen.findByRole("button", { name: "Delete document" });
    expect(remove.tagName).toBe("BUTTON");
  });

  it("does not show delete for shared documents", async () => {
    stubSignedInFetch([
      { id: "doc-1", body: "# Lead magnet", shareToken: "share-token" },
      { id: "doc-2", body: "# Prompt pack", sharedAt: "2026-07-02T12:00:00Z" }
    ]);

    await renderWrite();

    expect(await screen.findByRole("button", { name: /Lead magnet/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete document" })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copiedUrl = writeText.mock.calls[0][0] as string;
    expect(copiedUrl).toBe("http://localhost:3000/d/public-2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("Public link")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open public document" })).toHaveAttribute("href", "/d/public-2");
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

    render(<Write />);

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

    fireEvent.change(screen.getByRole("textbox", { name: "Search documents and tags" }), {
      target: { value: "Second" }
    });
    expect(second).toBeInTheDocument();

    fireEvent.click(second);
    expect((await screen.findAllByText("Full second body")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-2", { credentials: "include" });
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

    render(
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

    render(
      <AppProviders>
        <Write />
      </AppProviders>
    );

    expect(await screen.findByRole("button", { name: /First account/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
      target: { value: "# First account\n\nMust not cross accounts." }
    });

    window.dispatchEvent(new Event("focus"));

    expect(await screen.findByRole("button", { name: /Second account/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /First account/ })).not.toBeInTheDocument();
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

    render(<Write />);

    expect((await screen.findAllByText("Saved draft")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

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

    render(<Write />);

    const shared = await screen.findByRole("button", { name: "Shared" });
    expect(shared).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(shared);

    await waitFor(() => expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs/doc-1/share", {
      method: "DELETE",
      credentials: "include"
    });
  });
});
