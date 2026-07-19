import { render, screen, waitFor } from "@testing-library/react";
import { AppProviders, sessionRouteKey } from "./app-providers";
import { useAuth } from "./auth";

const navigation = vi.hoisted(() => ({ pathname: "/write" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname
}));

function AuthProbe() {
  const auth = useAuth();
  return <span>{auth.loading ? "checking" : auth.user?.email ?? "signed out"}</span>;
}

function ProtectedProbe() {
  const auth = useAuth();
  if (auth.loading || auth.routeRevalidating) return <span>waiting for session</span>;
  return <span>{auth.user ? "protected content" : "signed out"}</span>;
}

describe("AppProviders", () => {
  it("treats editor document URLs as one session route", () => {
    expect(sessionRouteKey("/write")).toBe("/write");
    expect(sessionRouteKey("/write/document-id")).toBe("/write");
  });

  it("refreshes the session in the background after navigation and window focus", async () => {
    navigation.pathname = "/write";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <AppProviders>
        <AuthProbe />
      </AppProviders>
    );

    await screen.findByText("writer@example.com");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    navigation.pathname = "/account";
    view.rerender(
      <AppProviders>
        <AuthProbe />
      </AppProviders>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("checking")).not.toBeInTheDocument();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("checking")).not.toBeInTheDocument();
  });

  it("holds protected content while a navigated route revalidates an expired session", async () => {
    navigation.pathname = "/write";
    let sessionRequests = 0;
    let resolveNavigation: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async () => {
      sessionRequests += 1;
      if (sessionRequests === 1) {
        return new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
          { status: 200 }
        );
      }
      return new Promise<Response>((resolve) => {
        resolveNavigation = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <AppProviders>
        <ProtectedProbe />
      </AppProviders>
    );
    await screen.findByText("protected content");

    navigation.pathname = "/account";
    view.rerender(
      <AppProviders>
        <ProtectedProbe />
      </AppProviders>
    );

    expect(screen.getByText("waiting for session")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    await waitFor(() => expect(resolveNavigation).toBeDefined());

    resolveNavigation?.(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("holds a protected route while navigation discovers a new authenticated session", async () => {
    navigation.pathname = "/login";
    let sessionRequests = 0;
    let resolveNavigation: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async () => {
      sessionRequests += 1;
      if (sessionRequests === 1) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      return new Promise<Response>((resolve) => {
        resolveNavigation = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <AppProviders>
        <ProtectedProbe />
      </AppProviders>
    );
    await screen.findByText("signed out");

    navigation.pathname = "/write";
    view.rerender(
      <AppProviders>
        <ProtectedProbe />
      </AppProviders>
    );

    expect(screen.getByText("waiting for session")).toBeInTheDocument();
    expect(screen.queryByText("signed out")).not.toBeInTheDocument();
    await waitFor(() => expect(resolveNavigation).toBeDefined());

    resolveNavigation?.(
      new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
        { status: 200 }
      )
    );
    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("does not revalidate or unmount content for editor document URL changes", async () => {
    navigation.pathname = "/write";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ authenticated: true, user: { id: "user-1", email: "writer@example.com" } }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <AppProviders>
        <ProtectedProbe />
      </AppProviders>
    );
    await screen.findByText("protected content");

    navigation.pathname = "/write/document-id";
    view.rerender(
      <AppProviders>
        <ProtectedProbe />
      </AppProviders>
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
    expect(screen.queryByText("waiting for session")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
