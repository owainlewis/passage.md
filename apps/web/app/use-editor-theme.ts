"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Theme } from "./editor-model";

const THEME_KEY = "passage.theme.v1";

function blockThemeTransitionsForNextPaint() {
  const root = document.documentElement;
  root.dataset.themeTransitionBlocked = "true";
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      delete root.dataset.themeTransitionBlocked;
    });
  });
}

export function useEditorTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  const darkActive = theme === "dark";

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTheme(stored);
      }
    } catch {
      // Storage may be blocked; keep the default theme.
    }
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (darkActive) {
      root.dataset.theme = "dark";
    } else {
      delete root.dataset.theme;
    }
  }, [darkActive]);

  function toggleDarkMode() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    blockThemeTransitionsForNextPaint();
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable; the choice stays in memory for this session.
    }
  }

  return { darkActive, theme, toggleDarkMode };
}
