const storageKey = "passage.public-theme.v1";
const root = document.documentElement;
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

type PublicTheme = "light" | "dark";

function storedTheme(): PublicTheme | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function activeTheme(): PublicTheme {
  const selected = root.dataset.theme;
  if (selected === "light" || selected === "dark") return selected;
  return systemDark.matches ? "dark" : "light";
}

const savedTheme = storedTheme();
if (savedTheme) root.dataset.theme = savedTheme;

function setupThemeControl() {
  const toggle = document.querySelector<HTMLButtonElement>(".themeToggle");
  if (!toggle) return;

  const updateControl = () => {
    const next = activeTheme() === "dark" ? "light" : "dark";
    const label = `Use ${next} theme`;
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };

  updateControl();

  toggle.addEventListener("click", () => {
    const next = activeTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Keep the explicit choice for this page when storage is unavailable.
    }
    updateControl();
    window.dispatchEvent(new Event("passage-theme-change"));
  });

  systemDark.addEventListener("change", () => {
    if (!root.dataset.theme) {
      updateControl();
      window.dispatchEvent(new Event("passage-theme-change"));
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupThemeControl, { once: true });
} else {
  setupThemeControl();
}

export {};
