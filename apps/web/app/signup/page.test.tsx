import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Signup from "./page";

describe("community signup policy acceptance", () => {
  it("requires explicit acceptance and submits the server policy version", async () => {
    window.history.replaceState({}, "", "/signup#ref=community&code=private-code");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
      }
      if (url === "/api/v1/auth/referral/validate") {
        return new Response(
          JSON.stringify({ name: "Community", policyVersion: "2026-07-31" }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/auth/referral-signup" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "test stopped after request" }), {
          status: 400
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Signup />);

    await screen.findByRole("heading", { name: "Create your account" });
    expect(window.location.pathname).toBe("/signup");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "member@example.com" }
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" }
    });

    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    expect(await screen.findByText("Terms and Privacy acceptance is required")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/v1/auth/referral-signup")
    ).toHaveLength(0);

    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy"
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input]) => String(input) === "/api/v1/auth/referral-signup"
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        ref: "community",
        code: "private-code",
        email: "member@example.com",
        password: "password123",
        policyVersion: "2026-07-31"
      });
    });
  });

  it("creates a free account when the server opens public signup", async () => {
    window.history.replaceState({}, "", "/signup");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({
            authenticated: false,
            publicSignupEnabled: true,
            policyVersion: "2026-07-31"
          }),
          { status: 200 }
        );
      }
      if (url === "/api/v1/auth/register" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "test stopped after request" }), {
          status: 400
        });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Signup />);

    await screen.findByText("Free account");
    expect(screen.getByText(/Start free with five saved Markdown documents/)).toBeInTheDocument();
    expect(screen.queryByText(/sharing, CLI, and API access/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "free@example.com" }
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" }
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input]) => String(input) === "/api/v1/auth/register"
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        email: "free@example.com",
        password: "password123",
        policyVersion: "2026-07-31"
      });
    });
  });
});
