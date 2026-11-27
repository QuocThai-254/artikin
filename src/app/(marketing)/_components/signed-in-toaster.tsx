"use client";

import dynamic from "next/dynamic";

// The root layout has no app-wide Toaster (ADR-037), so the account menu's toasts (a failed
// sign-out) need one on marketing pages. It is a separate chunk that only signed-in visitors load —
// the only ones with that menu — keeping sonner off the landing page's JavaScript for everyone else.
const Toaster = dynamic(() => import("@/components/ui/sonner").then((mod) => mod.Toaster), {
  ssr: false,
});

/** Toast region for signed-in visitors of marketing pages (the `(app)` layout mounts its own). */
export function SignedInToaster() {
  return <Toaster theme="dark" />;
}
