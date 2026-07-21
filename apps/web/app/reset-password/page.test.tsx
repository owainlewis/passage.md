import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ResetPassword from "./page";

describe("ResetPassword", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("removes the token from the URL and submits it once", async () => {
    window.history.replaceState(null, "", "/reset-password#token=reset_secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    render(<ResetPassword />);

    await waitFor(() => expect(window.location.hash).toBe(""));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Password reset");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/password-reset/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "reset_secret", password: "new-password-123" })
    });
  });

  it("rejects a page without a reset token", async () => {
    window.history.replaceState(null, "", "/reset-password");
    render(<ResetPassword />);
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or has expired");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });
});
