"use client";

import { AlertTriangle, Check, CircleDot, Loader2, type LucideIcon, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

import type { PersistenceStatus } from "../store/editor-store";

const LABELS: Record<"guest" | "cloud", Record<PersistenceStatus, string>> = {
  cloud: {
    idle: "Saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    offline: "Offline",
    error: "Error",
    conflict: "Conflict",
  },
  guest: {
    idle: "Draft",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Draft saved",
    offline: "Offline",
    error: "Not saved",
    conflict: "Conflict",
  },
};

const ICONS: Record<PersistenceStatus, LucideIcon> = {
  idle: Check,
  dirty: CircleDot,
  saving: Loader2,
  saved: Check,
  offline: WifiOff,
  error: AlertTriangle,
  conflict: AlertTriangle,
};

const TONES: Record<PersistenceStatus, string> = {
  idle: "border-border text-muted-foreground",
  dirty: "border-border text-foreground/80",
  saving: "border-border text-muted-foreground",
  saved: "border-border text-muted-foreground",
  offline: "border-amber-400/40 text-amber-300",
  error: "border-red-400/40 text-red-300",
  conflict: "border-amber-400/40 text-amber-300",
};

export function saveStatusLabel(mode: "guest" | "cloud", status: PersistenceStatus): string {
  return LABELS[mode][status];
}

/**
 * Save status chip (PROJECT F12: Saved · Saving… · Unsaved changes · Offline · Error). Tests read
 * the machine state from `data-status` (TEST_PLAN §6.2) and `data-camera-pending` (a camera view not
 * sent yet, ADR-058); details go in `title`.
 */
export function SaveStatusBadge({
  mode,
  status,
  detail,
  cameraPending = false,
  className,
}: {
  mode: "guest" | "cloud";
  status: PersistenceStatus;
  /** Longer explanation (tooltip), e.g. the error message or the last save time. */
  detail?: string;
  /** Cloud: the camera view changed but waits for the next save (it doesn't make the scene unsaved). */
  cameraPending?: boolean;
  className?: string;
}) {
  const Icon = ICONS[status];
  const label = LABELS[mode][status];
  return (
    <span
      data-testid="save-status"
      data-status={status}
      data-camera-pending={cameraPending ? "true" : undefined}
      title={detail ?? label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap",
        TONES[status],
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-3", status === "saving" && "animate-spin")} />
      <span className="max-lg:sr-only">{label}</span>
    </span>
  );
}
