import { render, screen, within } from "@testing-library/react";
import Admin from "./page";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/admin");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin", () => {
  it("keeps the admin shell visible while accounts load", async () => {
    let resolveDashboard: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "owner", email: "owain@owainlewis.com" } }),
          { status: 200 }
        );
      }
      if (String(input) === "/api/v1/admin/dashboard") {
        return new Promise<Response>((resolve) => {
          resolveDashboard = resolve;
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Admin />);

    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading accounts" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Admin navigation" })).toBeInTheDocument();

    await vi.waitFor(() => expect(resolveDashboard).toBeDefined());
    resolveDashboard?.(
      new Response(JSON.stringify({ totals: { users: 0, free: 0, pro: 0 }, users: [] }), { status: 200 })
    );
  });

  it("renders account totals and users for an owner", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "owner", email: "owain@owainlewis.com" } }),
          { status: 200 }
        );
      }
      if (String(input) === "/api/v1/admin/dashboard") {
        return new Response(
          JSON.stringify({
            totals: { users: 3, free: 1, pro: 2 },
            users: [
              {
                id: "owner",
                email: "owain@owainlewis.com",
                createdAt: "2026-07-18T10:00:00Z",
                plan: "pro",
                source: "owner",
                savedDocs: 2
              },
              {
                id: "paid",
                email: "paid@example.com",
                createdAt: "2026-07-17T10:00:00Z",
                plan: "pro",
                source: "stripe",
                subscriptionStatus: "active",
                savedDocs: 8
              },
              {
                id: "free",
                email: "free@example.com",
                createdAt: "2026-07-16T10:00:00Z",
                plan: "free",
                source: "default",
                savedDocs: 1
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Admin />);

    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    const totals = await screen.findByLabelText("Account totals");
    expect(within(totals).getByText("3")).toBeInTheDocument();
    expect(within(totals).getByText("1")).toBeInTheDocument();
    expect(within(totals).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("owain@owainlewis.com")).toBeInTheDocument();
    expect(screen.getByText("paid@example.com")).toBeInTheDocument();
    expect(screen.getByText("free@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/dashboard", { credentials: "include" });
  });

  it("does not request admin data while signed out", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Admin />);

    expect(await screen.findByRole("status", { name: "Redirecting to sign in" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/admin/dashboard", expect.anything());
  });

  it("shows no account data when the server rejects a non-admin", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "member", email: "member@example.com" } }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "admin access required" }), { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Admin />);

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Accounts" })).not.toBeInTheDocument();
  });
});
