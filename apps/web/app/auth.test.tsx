import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AuthBoundary, AuthProvider, useAuth } from "./auth";

function AuthProbe() {
  const auth = useAuth();
  return <span>{auth.loading ? "checking" : auth.user?.email ?? "signed out"}</span>;
}

function AuthActionsProbe() {
  const auth = useAuth();
  const [error, setError] = useState("");

  return (
    <>
      <span>{auth.loading ? "checking" : auth.user?.email ?? "signed out"}</span>
      <span>{error}</span>
      <span data-testid="session-status">{auth.sessionStatus}</span>
      <button
        type="button"
        onClick={() => void auth.signIn("writer@example.com", "password123").catch((err) => setError(err.message))}
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={() =>
          void auth
            .referralSignup("community", "code", "member@example.com", "password123", "2026-07-29")
            .catch((err) => setError(err.message))
        }
      >
        Join
      </button>
      <button type="button" onClick={() => void auth.refreshAccount().catch((err) => setError(err.message))}>
        Refresh
      </button>
      <button
        type="button"
        onClick={() =>
          void auth.refreshAccount({ requireVerified: true }).catch((err) => setError(err.message))
        }
      >
        Verify route
      </button>
      <button type="button" onClick={() => void auth.signOut().catch((err) => setError(err.message))}>
        Sign out
      </button>
    </>
  );
}

describe("AuthBoundary", () => {
  it("reuses an existing provider instead of loading the session again", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthBoundary>
          <AuthProbe />
        </AuthBoundary>
      </AuthProvider>
    );

    await screen.findByText("writer@example.com");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe("AuthProvider", () => {
  it.each([
    ["Sign in", "/api/v1/auth/login", "writer@example.com"],
    ["Join", "/api/v1/auth/referral-signup", "member@example.com"]
  ])("keeps the authenticated user from a successful %s response when session refresh fails", async (button, path, email) => {
    let sessionRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
      }
      if (url === path && init?.method === "POST") {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email } }),
          { status: path.endsWith("referral-signup") ? 201 : 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("signed out");
    fireEvent.click(screen.getByRole("button", { name: button }));

    expect(await screen.findByText(email)).toBeInTheDocument();
    expect(screen.queryByText("Account could not be loaded")).not.toBeInTheDocument();
  });

  it.each([
    ["Sign in", "/api/v1/auth/login"],
    ["Join", "/api/v1/auth/referral-signup"]
  ])("rejects a successful %s response when the session remains anonymous", async (button, path) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      if (url === path && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "user-1", email: "writer@example.com" }
          }),
          { status: path.endsWith("referral-signup") ? 201 : 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("signed out");
    fireEvent.click(screen.getByRole("button", { name: button }));

    expect(await screen.findByText("Session could not be established")).toBeInTheDocument();
    expect(screen.getByText("signed out")).toBeInTheDocument();
    expect(screen.getByTestId("session-status")).toHaveTextContent("anonymous");
  });

  it("discards a session refresh that started before sign out", async () => {
    let sessionRequests = 0;
    let resolveRefresh: ((response: Response) => void) | undefined;
    const user = { id: "user-1", email: "writer@example.com" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
        }
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      if (url === "/api/v1/auth/logout" && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("writer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(resolveRefresh).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByText("signed out");

    await act(async () => {
      resolveRefresh?.(new Response(JSON.stringify({ authenticated: true, user }), { status: 200 }));
    });
    expect(screen.getByText("signed out")).toBeInTheDocument();
    expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument();
  });

  it("does not start a background refresh while sign out is pending", async () => {
    let sessionRequests = 0;
    let resolveLogout: ((response: Response) => void) | undefined;
    const user = { id: "user-1", email: "writer@example.com" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
        }
        return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
      }
      if (url === "/api/v1/auth/logout" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveLogout = resolve;
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("writer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(resolveLogout).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(sessionRequests).toBe(1);

    await act(async () => {
      resolveLogout?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    expect(screen.getByText("signed out")).toBeInTheDocument();
    expect(screen.queryByText("writer@example.com")).not.toBeInTheDocument();
  });

  it("does not let a background refresh supersede the post-login session load", async () => {
    let sessionRequests = 0;
    let resolveLoginSession: ((response: Response) => void) | undefined;
    const user = { id: "user-1", email: "writer@example.com" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
        }
        return new Promise<Response>((resolve) => {
          resolveLoginSession = resolve;
        });
      }
      if (url === "/api/v1/auth/login" && init?.method === "POST") {
        return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("signed out");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(resolveLoginSession).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(sessionRequests).toBe(2);

    await act(async () => {
      resolveLoginSession?.(new Response(JSON.stringify({ authenticated: true, user }), { status: 200 }));
    });
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();
  });

  it("preserves a known session when an ordinary background refresh fails", async () => {
    let sessionRequests = 0;
    const user = { id: "user-1", email: "writer@example.com" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/me") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("writer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(sessionRequests).toBe(2));
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();
  });

  it("ignores a stale route failure after a newer refresh succeeds", async () => {
    let sessionRequests = 0;
    let resolveRoute: ((response: Response) => void) | undefined;
    const user = { id: "user-1", email: "writer@example.com" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/v1/me") {
        return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
      }
      sessionRequests += 1;
      if (sessionRequests === 1 || sessionRequests === 3) {
        return new Response(JSON.stringify({ authenticated: true, user }), { status: 200 });
      }
      return new Promise<Response>((resolve) => {
        resolveRoute = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <AuthActionsProbe />
      </AuthProvider>
    );

    await screen.findByText("writer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Verify route" }));
    await waitFor(() => expect(resolveRoute).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(sessionRequests).toBe(3));

    await act(async () => {
      resolveRoute?.(new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 }));
    });
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("session-status")).toHaveTextContent("authenticated");
  });
});
