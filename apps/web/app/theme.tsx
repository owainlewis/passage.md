"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Theme } from "./editor-model";

export const THEME_KEY = "passage.theme.v1";

/**
 * Applies the stored theme before the first paint. Inlined in the document
 * head so a dark-theme reader never sees a light flash while React hydrates.
 * Kept in sync with THEME_KEY and the useLayoutEffect below.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // Storage may be blocked; fall back to the default theme.
    return null;
  }
}

function blockThemeTransitionsForNextPaint() {
  const root = document.documentElement;
  root.dataset.themeTransitionBlocked = "true";
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      delete root.dataset.themeTransitionBlocked;
    });
  });
}

type ThemeContextValue = {
  darkActive: boolean;
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleDarkMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const darkActive = theme === "dark";

  useEffect(() => {
    const stored = storedTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setThemeState(stored);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (darkActive) {
      root.dataset.theme = "dark";
    } else {
      delete root.dataset.theme;
    }
  }, [darkActive]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState((current) => {
      if (current !== next) blockThemeTransitionsForNextPaint();
      return next;
    });
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable; the choice stays in memory for this session.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      darkActive,
      theme,
      setTheme,
      toggleDarkMode: () => setTheme(darkActive ? "light" : "dark")
    }),
    [darkActive, setTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
