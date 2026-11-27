"use client";

import { Focus, Lock, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor, useEditorStore } from "../store/context";
import type { ViewPreset } from "../store/editor-store";

const VIEWS: { view: ViewPreset; label: string; short: string; key?: string; testId: string }[] = [
  { view: "front", label: "Front view", short: "Front", key: "1", testId: "view-preset-front" },
  { view: "back", label: "Back view", short: "Back", key: "2", testId: "view-preset-back" },
  { view: "left", label: "Left view (figure's left side)", short: "Left", key: "3", testId: "view-preset-left" },
  { view: "right", label: "Right view (figure's right side)", short: "Right", key: "4", testId: "view-preset-right" },
  { view: "top", label: "Top view", short: "Top", key: "5", testId: "view-preset-top" },
  { view: "threeQuarterLeft", label: "Three-quarter front-left view", short: "¾ L", testId: "view-preset-three-quarter-left" },
  { view: "threeQuarterRight", label: "Three-quarter front-right view", short: "¾ R", testId: "view-preset-three-quarter-right" },
];

export const VIEW_LOCKED_HINT = "View locked — press V to unlock";

/**
 * Camera shortcuts over the viewport (PROJECT F4): view presets, frame selection, turntable. While the
 * view is locked (F6) the buttons stay focusable — their tooltip says why — but are `aria-disabled`; the
 * store refuses the camera commands.
 */
export function ViewControls() {
  const store = useEditorStore();
  const turntable = useEditor((s) => s.turntable.enabled);
  const viewLocked = useEditor((s) => s.scene.lock.view);
  const s = () => store.getState();
  const lockedClass = viewLocked ? "cursor-not-allowed opacity-50 hover:bg-transparent" : "";
  return (
    <div
      data-testid="view-cube"
      // Auto framing keeps bulbs left of this cluster (camera-rig.tsx).
      data-viewport-overlay="top-right"
      role="group"
      aria-label="Camera views"
      className="pointer-events-auto absolute top-2 right-2 flex flex-col gap-1 rounded-lg border border-border bg-card/85 p-1 shadow-lg backdrop-blur"
    >
      {viewLocked && (
        <div data-testid="view-locked-badge" className="flex items-center justify-center gap-1 px-1 py-0.5 text-[11px] font-medium text-amber-300">
          <Lock className="size-3" aria-hidden />
          View locked
        </div>
      )}
      <div className="grid grid-cols-2 gap-0.5">
        {VIEWS.map((v) => (
          <Tooltip key={v.view}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                data-testid={v.testId}
                // The accessible name contains the visible text (WCAG 2.5.3 label in name).
                aria-label={v.label.toLowerCase().includes(v.short.toLowerCase()) ? v.label : `${v.short} — ${v.label}`}
                aria-disabled={viewLocked || undefined}
                className={lockedClass}
                onClick={() => s().requestView(v.view)}
              >
                {v.short}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {viewLocked ? VIEW_LOCKED_HINT : `${v.label}${v.key ? ` (${v.key})` : ""}`}
            </TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              data-testid="view-frame-selection"
              aria-label="Frame selection"
              aria-disabled={viewLocked || undefined}
              className={lockedClass}
              onClick={() => s().requestFrameSelection()}
            >
              <Focus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{viewLocked ? VIEW_LOCKED_HINT : "Frame selection (F)"}</TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={turntable ? "secondary" : "ghost"}
            size="xs"
            data-testid="view-turntable"
            aria-pressed={turntable}
            aria-label="Turntable"
            aria-disabled={viewLocked || undefined}
            className={cn(turntable && "text-primary", lockedClass)}
            onClick={() => s().setTurntable({ enabled: !turntable })}
          >
            <RefreshCw className={turntable ? "animate-spin [animation-duration:3s]" : ""} /> Turntable
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{viewLocked ? VIEW_LOCKED_HINT : "Turntable (T)"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
