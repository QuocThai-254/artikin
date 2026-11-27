"use client";

import { AlertTriangle, RotateCcw, WifiOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { authPageHref } from "@/features/auth/callback-url";
import { cn } from "@/lib/utils";

import { useCloudSession, useCloudState } from "./cloud-context";

function Banner({ tone, kind, children }: { tone: "warning" | "error"; kind: string; children: ReactNode }) {
  return (
    <div
      data-testid="save-banner"
      data-kind={kind}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs",
        tone === "error" ? "border-red-400/25 bg-red-500/10 text-red-100" : "border-amber-400/25 bg-amber-400/10 text-amber-100",
      )}
    >
      {children}
    </div>
  );
}

/** Explains offline, error and conflict states above the canvas, with the matching action. */
export function CloudBanner() {
  const session = useCloudSession();
  // Only the states with a banner: routine dirty → saving → saved transitions don't re-render it.
  const status = useCloudState(({ save }) =>
    save.status === "conflict" || save.status === "offline" || save.status === "error" ? save.status : null,
  );
  const error = useCloudState(({ save }) => save.error);
  const dialogOpen = useCloudState((state) => state.conflictDialogOpen);

  if (status === "conflict") {
    if (dialogOpen) return null;
    return (
      <Banner tone="warning" kind="conflict">
        <AlertTriangle aria-hidden className="size-3.5" />
        <span>This workspace was changed somewhere else. Saving is paused until you choose a version.</span>
        <Button variant="outline" size="xs" onClick={() => session.setConflictDialogOpen(true)}>
          Choose version…
        </Button>
      </Banner>
    );
  }

  if (status === "offline") {
    return (
      <Banner tone="warning" kind="offline">
        <WifiOff aria-hidden className="size-3.5" />
        <span>{error?.message ?? "You're offline. Your changes are saved when you reconnect."}</span>
      </Banner>
    );
  }

  if (status === "error" && error) {
    const { kind, message } = error;
    return (
      <Banner tone="error" kind={kind}>
        <AlertTriangle aria-hidden className="size-3.5" />
        <span>{message}</span>
        {kind === "not-found" ? (
          <Button asChild variant="outline" size="xs">
            <Link href="/workspaces">Back to workspaces</Link>
          </Button>
        ) : (
          <Button variant="outline" size="xs" onClick={() => session.saveNow()}>
            <RotateCcw aria-hidden />
            Retry now
          </Button>
        )}
        {kind === "unauthorized" ? (
          <Button asChild variant="link" size="xs" className="text-red-100">
            <a href={authPageHref("/sign-in", "/workspaces")} target="_blank" rel="noopener">
              Sign in (new tab)
            </a>
          </Button>
        ) : null}
      </Banner>
    );
  }

  return null;
}
