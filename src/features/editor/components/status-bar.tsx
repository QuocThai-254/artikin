"use client";

import { Lock } from "lucide-react";

import type { PosableBoneName } from "@/lib/mannequin/bones";
import { DOF_INDEX, getBoneRom } from "@/lib/mannequin/rom";
import { boneLabel } from "../lib/bone-labels";
import { useEditor } from "../store/context";
import { canEditPose, isMasterLocked, lockSummary } from "../store/guards";

const TOOL_HINT: Record<string, string> = {
  rotate: "Click a body part, then drag a colored ring · sliders on the right for precise values",
  drag: "Pull a hand, foot or head handle · drag the hips handle to move the body with feet planted",
  move: "Drag a figure across the floor · drag the floor ring to turn it",
};

/** E.g. "Pose locked · lights and view still editable"; null when nothing is locked. */
function lockHint(lock: { pose: boolean; lights: boolean; view: boolean }): string | null {
  const summary = lockSummary(lock);
  if (!summary) return null;
  if (isMasterLocked(lock)) return "Locked · pose, lights and view are fixed — press L to unlock";
  const free = [!lock.pose && "pose", !lock.lights && "lights", !lock.view && "view"].filter((p): p is string => !!p);
  return `${summary} · ${free.join(" and ")} still editable`;
}

function Angles({ mannequinId, bone }: { mannequinId: string; bone: PosableBoneName }) {
  const angles = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.pose[bone]);
  const rom = getBoneRom(bone);
  return (
    <span data-testid="status-angles" className="truncate font-mono tabular-nums">
      {rom.dofs
        .map((d) => `${rom.labels[d]?.positive ?? d} ${Math.round((angles?.[DOF_INDEX[d]] ?? 0) * 10) / 10}°`)
        .join(" · ")}
    </span>
  );
}

export function StatusBar() {
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const lock = useEditor((s) => s.scene.lock);
  const label = useEditor((s) => {
    const sel = s.selection;
    if (sel.kind === "bone") return `${s.scene.mannequins.find((m) => m.id === sel.mannequinId)?.name ?? ""} · ${boneLabel(sel.bone)}`;
    if (sel.kind === "mannequin") return s.scene.mannequins.find((m) => m.id === sel.mannequinId)?.name ?? "";
    if (sel.kind === "light") return s.scene.lights.find((l) => l.id === sel.lightId)?.name ?? "";
    return "Nothing selected";
  });
  const locked = useEditor((s) => {
    const sel = s.selection;
    return (sel.kind === "bone" || sel.kind === "mannequin") && !canEditPose(s.scene, sel.mannequinId);
  });
  const hint = lockHint(lock) ?? TOOL_HINT[tool];
  const lockText = lockSummary(lock);

  return (
    <footer
      data-testid="status-bar"
      className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-card/80 px-3 text-[11px] text-muted-foreground"
    >
      <span data-testid="status-selection" className="truncate font-medium text-foreground/90">
        {label}
      </span>
      {selection.kind === "bone" && <Angles mannequinId={selection.mannequinId} bone={selection.bone} />}
      {locked && <span className="shrink-0 text-amber-300">Pose locked</span>}
      <span data-testid="status-hint" className="ml-auto hidden truncate md:inline">
        {hint}
      </span>
      {lockText && (
        <span data-testid="status-lock" className="ml-auto flex shrink-0 items-center gap-1 text-amber-300 md:ml-0">
          <Lock className="size-3" /> {lockText}
        </span>
      )}
    </footer>
  );
}
