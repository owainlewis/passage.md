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
  limits: { maxSavedDocs: 1000 },
  usage: { savedDocs: 1 },
  subscription: { stripeCustomerId: "cus_test", status: "active", cancelAtPeriodEnd: false }
};
const manualProAccount = {
  plan: "pro",
  source: "manual",
  limits: { maxSavedDocs: 1000 },
  usage: { savedDocs: 1 },
  subscription: { status: "active", cancelAtPeriodEnd: false }
};
const communityProAccount = {
  plan: "pro",
  source: "community",
  limits: { maxSavedDocs: 1000 },
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/v1/me") {
      return new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" }, account: proAccount }),
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
  const view = render(<Write />);
  await screen.findByRole("region", { name: "Markdown editor" });
  await waitFor(() => expect(screen.queryByRole("status", { name: "Loading saved docs" })).not.toBeInTheDocument());
  return view;
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
    for (const cliLink of screen.getAllByRole("link", { name: "CLI" })) {
      expect(cliLink).toHaveAttribute("href", "/cli");
    }
    expect(screen.getAllByRole("link", { name: "Start writing" }).length).toBeGreaterThan(0);
    expect(screen.getByText("$6.99")).toHaveTextContent("$6.99 USD / month");
    expect(screen.getByText(/Renews monthly until cancelled/)).toBeInTheDocument();
    expect(screen.getByText("Operated by Owain Lewis.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "owain@owainlewis.com" })).toHaveAttribute(
      "href",
      "mailto:owain@owainlewis.com"
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

  it("shows public signup actions only when the server enables them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            authenticated: false,
            publicSignupEnabled: true,
            policyVersion: "2026-07-27"
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
    expect(screen.getAllByRole("link", { name: "owain@owainlewis.com" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: "Policy links" })).toBeInTheDocument();
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
          JSON.stringify({ name: "AI Engineer", policyVersion: "2026-07-27" }),
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
          policyVersion: "2026-07-27"
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
      if (url === "/api/v1/docs") {
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
      if (url === "/api/v1/docs") {
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
      if (url === "/api/v1/docs" && method === "GET") {
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

  it("filters private and shared documents with fixed system folders", async () => {
    stubSignedInFetch([
      { id: "doc-private", body: "# Private note\n\nDraft." },
      { id: "doc-shared", body: "# Shared note\n\nPublished.", sharedAt: "2026-07-09T08:00:00Z" }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    expect(screen.getByRole("button", { name: "Open Private folder" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Open Shared folder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete .* folder/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Document location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Shared note/ })).not.toBeInTheDocument();

    const sharedFolder = screen.getByRole("button", { name: "Open Shared folder" });
    fireEvent.click(sharedFolder);

    expect(sharedFolder).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Shared note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Private note/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Shared note", level: 1 }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Published.").length).toBeGreaterThan(0);
  });

  it("clears the typed tag filter when changing folders", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Open Shared folder" }));

    expect(screen.getByRole("textbox", { name: "Filter by tag" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /Shared note/ })).toBeInTheDocument();
  });

  it("keeps empty system folders visible but disabled", async () => {
    stubSignedInFetch([{ id: "doc-private", body: "# Private note\n\nDraft." }]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    const sharedFolder = screen.getByRole("button", { name: "Open Shared folder" });
    expect(sharedFolder).toBeDisabled();
    fireEvent.click(sharedFolder);

    expect(screen.getByRole("button", { name: "Open Private folder" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Private note/ })).toBeInTheDocument();
    expect(screen.queryByText("No documents match.")).not.toBeInTheDocument();
  });

  it("moves to Shared after deleting the last private document", async () => {
    stubSignedInFetch([
      { id: "doc-private", body: "# Private note\n\nDraft." },
      { id: "doc-shared", body: "# Shared note\n\nPublished.", sharedAt: "2026-07-09T08:00:00Z" }
    ]);

    await renderWrite();
    await screen.findByRole("button", { name: /Private note/ });

    fireEvent.click(screen.getByRole("button", { name: "Delete document" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Open Shared folder" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("button", { name: "Open Private folder" })).toBeDisabled();
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

  it("moves a document into Shared when it is shared", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await renderWrite();
    await screen.findByRole("button", { name: /Markdown for agents and humans/ });

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Open Shared folder" })).toHaveAttribute("aria-current", "page"));
    expect(await screen.findByRole("button", { name: /Markdown for agents and humans/ })).toBeInTheDocument();
  });

  it("orders a newly shared document as latest in Shared", async () => {
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Open Shared folder" })).toHaveAttribute("aria-current", "page"));
    const rows = screen.getAllByRole("button", { name: /note/ }).map((button) => button.textContent ?? "");
    expect(rows[0]).toContain("Private note");
    expect(rows[1]).toContain("Shared note");
  });

  it("moves a document back to Private when it is unshared", async () => {
    stubSignedInFetch([{ id: "doc-shared", body: "# Shared draft", shareToken: "share-token", sharedAt: "2026-07-09T08:00:00Z" }]);

    await renderWrite();
    await screen.findByRole("button", { name: /Shared draft/ });

    expect(screen.getByRole("button", { name: "Open Shared folder" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Open Private folder" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("button", { name: /Shared draft/ })).toBeInTheDocument();
  });

  it("orders a newly unshared document as latest in Private", async () => {
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

    await waitFor(() => expect(screen.getByRole("button", { name: "Open Private folder" })).toHaveAttribute("aria-current", "page"));
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

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
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

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
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
      if (url === "/api/v1/docs" && method === "GET") {
        return new Response(JSON.stringify({ documents: [{ id: "doc-1", publicId: "public-1", body: "# One" }] }), {
          status: 200
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    await renderWrite();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));

    expect(await screen.findByText("Free includes 1 saved documents. Upgrade for more.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/docs",
      expect.objectContaining({ method: "POST" })
    );
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
      if (url === "/api/v1/docs" && method === "GET") {
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
            policyVersion: "2026-07-27"
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

  it("keeps API token management on the account settings page", async () => {
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
    await waitFor(() => expect(screen.queryByText("Loading saved docs")).not.toBeInTheDocument());
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/docs", { credentials: "include" });
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
      if (url === "/api/v1/docs" && !init?.method) {
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
      if (url === "/api/v1/docs" && !init?.method) {
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
      if (url === "/api/v1/docs" && !init?.method) {
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
      if (url === "/api/v1/docs" && !init?.method) {
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
