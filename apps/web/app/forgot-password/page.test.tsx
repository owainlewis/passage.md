import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ForgotPassword from "./page";

describe("ForgotPassword", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests a reset without changing the generic response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "If an account exists for that email, a password reset link is on its way." }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      })
    );
    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "writer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("If an account exists");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/password-reset/request", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "writer@example.com" })
    });
  });

  it("shows a safe unavailable error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "password reset is temporarily unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })
    );
    render(<ForgotPassword />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "writer@example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send reset link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable"));
  });
});
