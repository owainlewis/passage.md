import { render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "./app-providers";
import { useAuth } from "./auth";

const navigation = vi.hoisted(() => ({ pathname: "/write" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname
}));

function AuthProbe() {
  const auth = useAuth();
  return <span>{auth.loading ? "checking" : auth.user?.email ?? "signed out"}</span>;
}

describe("AppProviders", () => {
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
});
