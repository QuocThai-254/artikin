"use client";

import Link from "next/link";
import { useEffect, type KeyboardEvent } from "react";

import { useAuthHintState } from "@/components/auth-switch";
import { Button } from "@/components/ui/button";
import { authPageHref } from "@/features/auth/callback-url";
import type { FigurePreset } from "@/features/figure-presets/contract";
import { getBodyPreset } from "@/lib/mannequin/presets/body";
import {
  bodyPresetOfFigurePreset,
  posePresetOfFigurePreset,
} from "@/lib/mannequin/presets/figure-preset";
import { cn } from "@/lib/utils";

import { useMyPresets, useMyPresetsStore } from "./my-presets-store";
import { PresetPreview } from "./preset-preview";
import { bodyPreview, posePreview } from "./preview-shapes";

/**
 * Whether "My presets" can talk to the API: the auth hint cookie says signed in (FT-02, no request)
 * and the API hasn't answered 401. Signing out forgets the cached presets.
 */
export function useCanUseMyPresets(): boolean {
  const hint = useAuthHintState();
  const store = useMyPresetsStore();
  const unauthorized = useMyPresets((state) => state.unauthorized);
  useEffect(() => {
    if (hint !== "in") store.getState().reset();
  }, [hint, store]);
  return hint === "in" && !unauthorized;
}

/** Where sign-in should bring the user back: this editor (guest draft or workspace). */
export function editorReturnPath(): string {
  if (typeof window === "undefined") return "/editor";
  const { pathname } = window.location;
  return /^\/editor(?:\/[\w-]+)?$/.test(pathname) ? pathname : "/editor";
}

/** Guest (or expired session) prompt with sign-in / sign-up links back to the editor. */
export function SignInForMyPresets({ className }: { className?: string }) {
  const returnPath = editorReturnPath();
  const unauthorized = useMyPresets((state) => state.unauthorized);
  return (
    <div data-testid="my-presets-sign-in" role="note" className={cn("flex flex-col gap-2 text-xs", className)}>
      <p className="font-medium text-foreground">
        {unauthorized ? "Your session has ended. Sign in again to use your presets." : "Sign in to save your own presets"}
      </p>
      <p className="text-muted-foreground">
        Keep the figures you shape — body, proportions, material and pose — and reuse them in any workspace.
        {returnPath === "/editor" ? " Your guest scene stays in this browser." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={authPageHref("/sign-in", returnPath)} data-testid="my-presets-sign-in-link">
            Sign in
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={authPageHref("/sign-up", returnPath)} data-testid="my-presets-sign-up-link">
            Create account
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Cache key of a personal preset's previews (its document never changes). */
const previewId = (preset: FigurePreset) => `mine:${preset.id}`;

/** Body silhouette, plus a stick figure when the preset has a pose (both decorative). */
export function MyPresetPreview({ preset, className }: { preset: FigurePreset; className?: string }) {
  const pose = posePresetOfFigurePreset(previewId(preset), preset.name, preset.data);
  return (
    <span className={cn("flex shrink-0 gap-0.5", className)} aria-hidden="true">
      <PresetPreview
        preview={bodyPreview(bodyPresetOfFigurePreset(previewId(preset), preset.name, preset.data))}
        className="size-auto h-12 w-7 rounded-sm bg-muted text-foreground/85"
      />
      {pose && (
        <PresetPreview preview={posePreview(pose)} className="size-auto h-12 w-[3.75rem] rounded-sm bg-muted text-foreground/85" />
      )}
    </span>
  );
}

/** "Anime Child (~10 y) · with pose" — what a preset contains. */
export function describeMyPreset(preset: FigurePreset): string {
  return `${getBodyPreset(preset.data.body.presetId).name} · ${preset.data.pose ? "with pose" : "body only"}`;
}

/**
 * `onKeyDown` for these dialogs and menus: keys pressed inside them never reach the editor's window
 * shortcuts, which only know store-driven dialogs — Escape would also clear the selection and
 * Delete remove the selected figure. Radix still closes on Escape and traps Tab.
 */
export function keepKeysInside(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
}
