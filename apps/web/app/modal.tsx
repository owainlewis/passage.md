"use client";

import { RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";


const MODAL_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE))
    .filter((element) => !element.hidden);
}

export function Modal({
  ariaLabel,
  children,
  dismissDisabled = false,
  initialFocus,
  onClose
}: {
  ariaLabel: string;
  children: React.ReactNode;
  dismissDisabled?: boolean;
  initialFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const backdropPressStarted = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalRoot = backdrop.current;
    const body = document.body;
    const background = Array.from(body.children).filter((element) => element !== modalRoot);
    const previousInert = background.map((element) => [element, element.hasAttribute("inert")] as const);
    const previousOverflow = body.style.overflow;

    background.forEach((element) => element.setAttribute("inert", ""));
    body.style.overflow = "hidden";
    initialFocus.current?.focus();

    function keepFocusInside(event: FocusEvent) {
      if (dialog.current?.contains(event.target as Node)) return;
      if (!dialog.current) return;
      const focusable = focusableElements(dialog.current);
      const preferred = initialFocus.current && focusable.includes(initialFocus.current)
        ? initialFocus.current
        : focusable[0] ?? dialog.current;
      preferred.focus();
    }

    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      body.style.overflow = previousOverflow;
      previousInert.forEach(([element, wasInert]) => {
        if (!wasInert) element.removeAttribute("inert");
      });
      const element = trigger.current;
      window.requestAnimationFrame(() => {
        if (element?.isConnected) {
          element.focus();
        } else {
          document.querySelector<HTMLElement>(".wEditorPane")?.focus();
        }
      });
    };
  }, [initialFocus]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!dismissDisabled) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = focusableElements(dialog.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      ref={backdrop}
      className="wModalBackdrop"
      role="presentation"
      onPointerDown={(event) => {
        backdropPressStarted.current = event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        backdropPressStarted.current = false;
      }}
      onClick={(event) => {
        const shouldDismiss = backdropPressStarted.current && event.target === event.currentTarget;
        backdropPressStarted.current = false;
        if (!dismissDisabled && shouldDismiss) onClose();
      }}
    >
      <section
        ref={dialog}
        className="wModal"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>,
    document.body
  );
}
