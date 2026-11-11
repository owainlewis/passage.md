"use client";

import { useEffect, useState } from "react";
import type { OutlineItem } from "./visual-editor-modes";

// Fewer headings than this and the page itself is the outline.
export const OUTLINE_MIN_HEADINGS = 3;

/**
 * The shape of the document in the margin: one mark per heading, sized by
 * level. Reaching for it opens the headings by name, each with the words in
 * its section, and choosing one goes there.
 */
export function DocumentOutline({ items, activeHeading, onReveal }: {
  items: OutlineItem[];
  activeHeading: () => number;
  onReveal: (index: number) => void;
}) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(activeHeading()));
    }
    update();
    // Scroll does not bubble, so listen on the way down to the page.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [activeHeading, items]);

  if (items.length < OUTLINE_MIN_HEADINGS) return null;
  const top = Math.min(...items.map((item) => item.level));

  return (
    <nav className="wOutline" aria-label="Outline">
      <ol>
        {items.map((item, index) => (
          <li key={index}>
            <button
              type="button"
              data-depth={Math.min(item.level - top, 2)}
              aria-current={index === active ? "location" : undefined}
              onClick={() => onReveal(index)}
            >
              <span className="wOutlineMark" aria-hidden="true" />
              <span className="wOutlineText">{item.text}</span>
              <span className="wOutlineWords" aria-label={`${item.words} words`}>{item.words.toLocaleString("en-US")}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
