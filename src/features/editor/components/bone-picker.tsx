"use client";

import { useId } from "react";

import { type HumanBoneName, isPosableBoneName } from "@/lib/mannequin/bones";
import { BONE_PICKER_GROUPS, boneLabel } from "../lib/bone-labels";
import { useEditor, useEditorStore } from "../store/context";

const selectClass =
  "h-7 w-full rounded-md border border-input bg-input/30 px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** Figure the properties panel is about: the selected one, otherwise the first figure. */
export function useActiveMannequinId(): string | null {
  return useEditor((s) => {
    const sel = s.selection;
    if (sel.kind === "bone" || sel.kind === "mannequin") return sel.mannequinId;
    return s.scene.mannequins[0]?.id ?? null;
  });
}

/**
 * Keyboard bone picker (A11Y-03): choose any of the 51 bones of a figure without the canvas.
 */
export function BonePicker() {
  const store = useEditorStore();
  const id = useId();
  const mannequinId = useActiveMannequinId();
  const figures = useEditor((s) => s.scene.mannequins.map((m) => `${m.id}\u0000${m.name}`).join("\u0001"));
  const current = useEditor((s) => {
    const sel = s.selection;
    if (sel.kind === "bone") return sel.bone as string;
    if (sel.kind === "mannequin") return "hips";
    return "";
  });

  const list = figures ? figures.split("\u0001").map((f) => f.split("\u0000") as [string, string]) : [];
  if (!mannequinId || list.length === 0) return null;

  const choose = (bone: string) => {
    if (!bone) return;
    if (bone === "hips" || !isPosableBoneName(bone)) store.getState().select({ kind: "mannequin", mannequinId });
    else store.getState().select({ kind: "bone", mannequinId, bone });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {list.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-figure`} className="text-[11px] text-muted-foreground">
            Figure
          </label>
          <select
            id={`${id}-figure`}
            className={selectClass}
            value={mannequinId}
            onChange={(e) => store.getState().select({ kind: "mannequin", mannequinId: e.target.value })}
          >
            {list.map(([fid, name]) => (
              <option key={fid} value={fid}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-bone`} className="text-[11px] text-muted-foreground">
          Joint
        </label>
        <select
          id={`${id}-bone`}
          data-testid="bone-picker"
          className={selectClass}
          value={current}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="" disabled>
            Choose a joint…
          </option>
          {BONE_PICKER_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.bones.map((b: HumanBoneName) => (
                <option key={b} value={b}>
                  {boneLabel(b)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}

export { selectClass };
