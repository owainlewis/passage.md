"use client";

import Link from "next/link";
import { ReactNode, Ref, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind?: "action"; label: string; hint?: string; badge?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "link"; label: string; href: string }
  | { kind: "separator" }
  | { kind: "note"; label: string; detail?: string };

/**
 * An icon button that opens a small menu. Arrow keys move through the items,
 * Escape returns focus to the button, and a press outside closes it.
 */
export function MenuButton({
  disabled = false,
  label,
  icon,
  items
}: {
  disabled?: boolean;
  label: string;
  icon: ReactNode;
  items: MenuItem[];
}) {
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
        disabled={disabled}
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
      {open && !disabled && (
        <MenuList ref={menu} id={id} label={label} items={items} onClose={close} onNavigate={() => setOpen(false)} />
      )}
    </div>
  );
}

/**
 * The items of a menu, with arrow-key movement between them. Shared by the
 * button menu and the right-click menu so both look and behave the same.
 */
function MenuList({
  className = "wMenu",
  id,
  items,
  label,
  ref,
  style,
  onClose,
  onNavigate
}: {
  className?: string;
  id?: string;
  items: MenuItem[];
  label: string;
  ref: Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  onClose: () => void;
  onNavigate: () => void;
}) {
  return (
    <div
      ref={ref}
      id={id}
      className={className}
      role="menu"
      aria-label={label}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a, button:not(:disabled)"));
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
            <Link key={index} href={item.href} role="menuitem" className="wMenuItem" onClick={onNavigate}>
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
              onClose();
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
  );
}

// Space kept between a context menu and the edge of the window.
const EDGE = 8;

/**
 * A menu opened at the pointer by a right-click, or at the element by the
 * keyboard's menu key. It closes on Escape, a press outside, or a scroll, and
 * hands focus back to the element it was opened from.
 */
export function ContextMenu({
  items,
  label,
  x,
  y,
  returnFocus,
  onClose
}: {
  items: MenuItem[];
  label: string;
  x: number;
  y: number;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keeps the whole menu inside the window when opened near an edge.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE))
    });
  }, [x, y]);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("a, button:not(:disabled)")?.focus();
    function dismiss(event: Event) {
      if (!menu.current?.contains(event.target as Node)) onClose();
    }
    function dismissAll() {
      onClose();
    }
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("contextmenu", dismiss, true);
    window.addEventListener("resize", dismissAll);
    window.addEventListener("blur", dismissAll);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("contextmenu", dismiss, true);
      window.removeEventListener("resize", dismissAll);
      window.removeEventListener("blur", dismissAll);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [onClose]);

  return (
    <MenuList
      ref={menu}
      className="wMenu wContextMenu"
      label={label}
      items={items}
      style={{ left: position.left, top: position.top }}
      onClose={() => {
        onClose();
        returnFocus?.focus();
      }}
      onNavigate={onClose}
    />
  );
}
