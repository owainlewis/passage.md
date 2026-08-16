import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { THEME_BOOT_SCRIPT, THEME_KEY, ThemeProvider, useTheme } from "./theme";

const stylesheet = readFileSync("app/globals.css", "utf8");

function Probe() {
  const { darkActive, setTheme, theme, toggleDarkMode } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="dark">{String(darkActive)}</span>
      <button type="button" onClick={() => setTheme("dark")}>Set dark</button>
      <button type="button" onClick={() => setTheme("light")}>Set light</button>
      <button type="button" onClick={toggleDarkMode}>Toggle</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme provider", () => {
  it("defaults to light and leaves the document unmarked", () => {
    renderProbe();

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("restores a stored dark theme and marks the document", async () => {
    localStorage.setItem(THEME_KEY, "dark");
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("dark")).toHaveTextContent("true");
  });

  it("ignores a corrupted stored value instead of failing", async () => {
    localStorage.setItem(THEME_KEY, "chartreuse");
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("persists an explicit choice so other routes pick it up", () => {
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "Set dark" }));
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Set light" }));
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("still toggles when storage is unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    try {
      renderProbe();
      fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      setItem.mockRestore();
    }
  });

  it("suppresses transitions across a theme change so the swap does not smear", () => {
    renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "Set dark" }));

    expect(document.documentElement.dataset.themeTransitionBlocked).toBe("true");
    expect(stylesheet).toMatch(/html\[data-theme-transition-blocked\] \*/);
  });

  it("fails loudly when used outside the provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    } finally {
      error.mockRestore();
    }
  });
});

describe("pre-paint boot script", () => {
  it("applies a stored dark theme before React runs", () => {
    localStorage.setItem(THEME_KEY, "dark");
    new Function(THEME_BOOT_SCRIPT)();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("leaves the document alone for light and for unset storage", () => {
    localStorage.setItem(THEME_KEY, "light");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBeUndefined();

    localStorage.clear();
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("reads the same storage key the provider writes", () => {
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_KEY));
  });
});
