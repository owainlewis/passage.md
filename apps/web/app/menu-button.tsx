"use client";

import Link from "next/link";
import { ReactNode, useEffect, useId, useRef, useState } from "react";

export type MenuItem =
  | { kind?: "action"; label: string; hint?: string; badge?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "link"; label: string; href: string }
  | { kind: "separator" }
  | { kind: "note"; label: string; detail?: string };

/**
 * An icon button that opens a small menu. Arrow keys move through the items,
 * Escape returns focus to the button, and a press outside closes it.
 */
export function MenuButton({ label, icon, items }: { label: string; icon: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("a, button:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div
      ref={wrap}
      className="wMenuWrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="wIconButton"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          className="wMenu"
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              return;
            }
            const buttons = Array.from(menu.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)") ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLElement);
            const next = event.key === "Home" ? 0
              : event.key === "End" ? buttons.length - 1
                : event.key === "ArrowDown" ? (index + 1) % buttons.length
                  : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
                    : -1;
            if (next >= 0) {
              event.preventDefault();
              buttons[next]?.focus();
            }
          }}
        >
          {items.map((item, index) => {
            if (item.kind === "separator") return <hr key={index} className="wMenuRule" />;
            if (item.kind === "note") {
              return (
                <div key={index} className="wMenuNote">
                  <span>{item.label}</span>
                  {item.detail && <strong>{item.detail}</strong>}
                </div>
              );
            }
            if (item.kind === "link") {
              return (
                <Link key={index} href={item.href} role="menuitem" className="wMenuItem" onClick={() => setOpen(false)}>
                  <span>{item.label}</span>
                </Link>
              );
            }
            return (
              <button
                key={index}
                type="button"
                role="menuitem"
                className="wMenuItem"
                data-danger={item.danger || undefined}
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
                {item.badge && <span className="wMenuBadge">{item.badge}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
