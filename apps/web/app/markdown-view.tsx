"use client";

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

marked.setOptions({ gfm: true, breaks: false });

// Rendered Markdown can contain raw HTML, and shared documents are arbitrary
// input from whoever crafted the link, so sanitize before it ever hits the DOM.
function renderMarkdown(source: string): string {
  const html = marked.parse(source) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

let mermaidTheme: string | null = null;

async function loadMermaid(dark: boolean) {
  const mermaid = (await import("mermaid")).default;
  const theme = dark ? "dark" : "neutral";
  if (mermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
      fontFamily: "var(--font-sans), system-ui, sans-serif"
    });
    mermaidTheme = theme;
  }
  return mermaid;
}

export function MarkdownView({ source, theme = "light" }: { source: string; theme?: "light" | "dark" }) {
  const ref = useRef<HTMLElement>(null);
  const html = useMemo(() => renderMarkdown(source), [source]);

  // Render fenced ```mermaid blocks into diagrams once the HTML is in the DOM.
  // React owns this subtree via dangerouslySetInnerHTML and may swap nodes on
  // re-render, so we re-query the live DOM each pass instead of holding refs.
  useEffect(() => {
    const root = ref.current;
    if (!root || !root.querySelector("code.language-mermaid")) return;

    let cancelled = false;
    (async () => {
      let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
      try {
        mermaid = await loadMermaid(theme === "dark");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        root.querySelectorAll("code.language-mermaid").forEach((block) => {
          const pre = block.closest("pre");
          if (pre) replaceWithError(pre, `Diagram engine failed to load: ${message}`);
        });
        return;
      }

      let pass = 0;
      let block = root.querySelector<HTMLElement>("code.language-mermaid");
      while (block && !cancelled && pass < 100) {
        pass += 1;
        const pre = block.closest("pre");
        if (!pre) break;
        const code = block.textContent ?? "";
        const id = `mmd-${Math.random().toString(36).slice(2)}-${pass}`;
        try {
          const { svg } = await mermaid.render(id, code);
          if (cancelled) return;
          if (pre.isConnected) {
            const figure = document.createElement("figure");
            figure.className = "mermaidFigure";
            figure.innerHTML = svg;
            pre.replaceWith(figure);
          }
        } catch (err) {
          if (cancelled) return;
          if (pre.isConnected) {
            replaceWithError(pre, err instanceof Error ? err.message : String(err));
          }
          document.getElementById(id)?.remove();
        }
        block = root.querySelector<HTMLElement>("code.language-mermaid");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html, theme]);

  return <article ref={ref} className="markdown markdownView" dangerouslySetInnerHTML={{ __html: html }} />;
}

function replaceWithError(pre: Element, message: string) {
  const box = document.createElement("div");
  box.className = "mermaidError";
  box.textContent = message;
  pre.replaceWith(box);
}
