"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { hasAuthHint } from "@/lib/auth/auth-hint";

/** Why the hint disappeared on this page, so the header can move focus and announce it. */
export type AuthHintChange = "signed-out" | "session-ended";

/** Signed in (hint present); signed out; or signed out by something this page did or found. */
export type AuthHintState = "in" | "out" | AuthHintChange;

const CHANGE_EVENT = "artikin:auth-hint";

let lastChange: AuthHintChange | null = null;

/**
 * State of the auth hint cookie (S3's `@/lib/auth/auth-hint`, PROGRESS FT-02), which the auth
 * server sets with a session and clears on sign-out or when a session check finds none.
 */
function getAuthHintState(): AuthHintState {
  if (hasAuthHint(document.cookie)) {
    // A (new) session makes the reason for an earlier sign-out stale. Idempotent.
    lastChange = null;
    return "in";
  }
  return lastChange ?? "out";
}

/** The prerendered markup (and hydration) is always the visitor version. */
function getServerAuthHintState(): AuthHintState {
  return "out";
}

/**
 * Re-reads the hint on explicit changes and whenever the page becomes active again (another tab
 * may have signed in or out; a back/forward-cache restore may be stale).
 */
function subscribeAuthHint(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener("pageshow", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("pageshow", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Tells every island on the page to re-read the hint after a response that may have changed it
 * (sign-out, a session check), optionally saying why it would have gone away.
 */
export function announceAuthHintChange(reason?: AuthHintChange): void {
  if (reason) lastChange = reason;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Test helper: forget why the hint last went away (module state outlives a test's DOM). */
export function resetAuthHintStateForTests(): void {
  lastChange = null;
}

/** The auth hint state; the prerender and hydration always see `"out"`. */
export function useAuthHintState(): AuthHintState {
  return useSyncExternalStore(subscribeAuthHint, getAuthHintState, getServerAuthHintState);
}

/**
 * Client island for static pages: shows `signedIn` while the hint cookie is present, otherwise
 * `signedOut`. The server renders both; this only picks one, so visitors get the signed-out
 * markup in the prerendered HTML and signed-in visitors see theirs right after hydration.
 */
export function AuthSwitch({
  signedIn,
  signedOut = null,
}: {
  signedIn: ReactNode;
  signedOut?: ReactNode;
}) {
  return useAuthHintState() === "in" ? signedIn : signedOut;
}

const ANNOUNCEMENTS: Partial<Record<AuthHintState, string>> = {
  "signed-out": "You're signed out.",
  "session-ended": "Your session has ended. Sign in again to open your workspaces.",
};

/**
 * The header's account area on static pages: `AuthSwitch` plus feedback when this page signs the
 * visitor out or finds the session gone — a status announcement, and focus moved to "Sign in" if
 * it was lost with the account menu.
 */
export function HeaderAuthSwitch({
  signedIn,
  signedOut,
}: {
  signedIn: ReactNode;
  signedOut: ReactNode;
}) {
  const state = useAuthHintState();
  const slot = useRef<HTMLSpanElement>(null);
  const previous = useRef(state);

  useEffect(() => {
    const wasSignedIn = previous.current === "in";
    previous.current = state;
    if (!wasSignedIn || !ANNOUNCEMENTS[state]) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    slot.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [state]);

  return (
    <>
      <span ref={slot} className="contents">
        {state === "in" ? signedIn : signedOut}
      </span>
      <span role="status" className="sr-only">
        {ANNOUNCEMENTS[state] ?? ""}
      </span>
    </>
  );
}
