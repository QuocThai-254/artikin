"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * The element to give focus back to. A menu item unmounts with its menu, so a dialog opened from one
 * (e.g. the toolbar's More menu) returns focus to the menu's trigger (Radix labels the menu by it).
 */
export function resolveOpener(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const menu = active.closest('[role="menu"]');
  if (!menu) return active;
  const triggerId = menu.getAttribute("aria-labelledby");
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  return trigger instanceof HTMLElement ? trigger : null;
}

/**
 * Store-driven dialogs have no Radix `DialogTrigger`, so Radix cannot return focus when they close.
 * Remember the element focused when the dialog opens (e.g. the toolbar button) and give focus back
 * to it on close. Pass the returned handler to `DialogContent`'s `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  // Layout effect: runs before Radix moves focus into the dialog (its focus scope uses a passive effect).
  useLayoutEffect(() => {
    if (!open) return;
    opener.current = resolveOpener(document.activeElement);
  }, [open]);
  return (event: Event) => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) {
      event.preventDefault();
      el.focus();
    }
  };
}
