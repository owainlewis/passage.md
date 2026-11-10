import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import ForgotPassword from "./forgot-password/page";
import Login from "./login/page";
import ResetPassword from "./reset-password/page";
import Signup from "./signup/page";

const authStyles = readFileSync("app/auth.module.css", "utf8");
const globalStyles = readFileSync("app/globals.css", "utf8");

function stubSession(routes: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (routes[url]) return routes[url]();
      if (url === "/api/v1/me") {
        return new Response(
          JSON.stringify({ authenticated: false, publicSignupEnabled: true, policyVersion: "2026-07-31" }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    })
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  stubSession();
});

describe("sign-in pages", () => {
  it.each([
    ["sign in", <Login key="login" />, "Sign in to Passage", "Home", "/"],
    ["sign up", <Signup key="signup" />, "Create your account", "Sign in", "/login"],
    ["forgot password", <ForgotPassword key="forgot" />, "Reset your password", "Sign in", "/login"],
    ["reset password", <ResetPassword key="reset" />, "Choose a new password", "Sign in", "/login"]
  ])("frames %s with the wordmark home and one link out", async (_name, page, title, label, href) => {
    render(page);

    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "passage.md home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
  });

  it("announces a failed sign in and keeps what was typed", async () => {
    stubSession({
      "/api/v1/auth/login": () => new Response(JSON.stringify({ error: "invalid email or password" }), { status: 401 })
    });
    render(<Login />);

    await screen.findByText("Welcome back");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "writer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid email or password");
    expect(screen.getByLabelText("Email")).toHaveValue("writer@example.com");
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("announces a signup the reader has not finished", async () => {
    render(<Signup />);

    await screen.findByText("Free account");
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Terms and Privacy acceptance is required");
  });
});

describe("sign-in materials", () => {
  it("draws every colour from the shared paper tokens", () => {
    expect(authStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(authStyles).not.toMatch(/rgba?\(/);
    expect(authStyles).toMatch(/\.notice\[data-tone="error"\]\s*\{\s*color: var\(--p-danger\);/);
  });

  it("keeps fields large enough to tap and to type in without zooming", () => {
    const input = authStyles.match(/\.input\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(input).toMatch(/height: 44px;/);
    expect(input).toMatch(/font-size: 16px;/);
  });

  it("leaves no styles behind for the old sign-in look", () => {
    expect(globalStyles).not.toMatch(/\.login[A-Z]|\.betaLabel|\.policyConsent|\.authSuccess/);
  });
});
