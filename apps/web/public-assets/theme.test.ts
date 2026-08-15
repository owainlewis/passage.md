import { screen } from "@testing-library/react";

type ChangeListener = (event: MediaQueryListEvent) => void;

function stubSystemTheme(initiallyDark: boolean) {
  const listeners = new Set<ChangeListener>();
  const query = {
    matches: initiallyDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query as unknown as MediaQueryList));

  return {
    setDark(matches: boolean) {
      query.matches = matches;
      const event = { matches, media: query.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    }
  };
}

async function loadThemeScript() {
  await import("./theme");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return screen.getByRole("button");
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = `
    <button class="themeToggle" type="button" aria-label="Use dark theme">
      <svg class="moonIcon"></svg>
      <svg class="sunIcon"></svg>
    </button>
  `;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses system preference until the reader chooses a theme", async () => {
  const system = stubSystemTheme(true);
  const themeChange = vi.fn();
  window.addEventListener("passage-theme-change", themeChange);

  const toggle = await loadThemeScript();

  expect(document.documentElement).not.toHaveAttribute("data-theme");
  expect(toggle).toHaveAccessibleName("Use light theme");

  system.setDark(false);

  expect(document.documentElement).not.toHaveAttribute("data-theme");
  expect(toggle).toHaveAccessibleName("Use dark theme");
  expect(themeChange).toHaveBeenCalledTimes(1);
  window.removeEventListener("passage-theme-change", themeChange);
});

it("persists an explicit choice and restores it when the system differs", async () => {
  stubSystemTheme(false);
  const toggle = await loadThemeScript();

  toggle.click();

  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(localStorage.getItem("passage.public-theme.v1")).toBe("dark");
  expect(toggle).toHaveAccessibleName("Use light theme");

  vi.resetModules();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = `<button class="themeToggle" type="button" aria-label="Use dark theme"></button>`;
  const restoredToggle = await loadThemeScript();

  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(restoredToggle).toHaveAccessibleName("Use light theme");
});

it("keeps the page theme usable when browser storage throws", async () => {
  stubSystemTheme(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });

  const toggle = await loadThemeScript();
  toggle.click();

  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(toggle).toHaveAccessibleName("Use light theme");
});
