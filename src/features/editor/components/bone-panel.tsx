"use client";

import { FlipHorizontal2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BONE_GROUP, type PosableBoneName, getBoneSide, getBonesOf } from "@/lib/mannequin/bones";
import { DOF_INDEX, getBoneRom } from "@/lib/mannequin/rom";
import { boneLabel } from "../lib/bone-labels";
import { DOF_COLORS } from "../lib/dof-colors";
import { useEditor, useEditorStore } from "../store/context";
import { canEditPose } from "../store/guards";
import { SectionTitle } from "./fields";
import { LabeledSlider } from "./labeled-slider";

const ZERO: [number, number, number] = [0, 0, 0];

/** Bones reset by "Reset limb": the bone's limb group on its side (torso & head for center bones). */
function limbOf(bone: PosableBoneName): PosableBoneName[] {
  const side = getBoneSide(bone);
  const group = BONE_GROUP[bone];
  const list =
    side === "center" ? [...getBonesOf("torso", "center"), ...getBonesOf("head", "center")] : getBonesOf(group, side);
  return list.filter((b): b is PosableBoneName => b !== "hips");
}

export function BonePanel({ mannequinId, bone }: { mannequinId: string; bone: PosableBoneName }) {
  const store = useEditorStore();
  const angles = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.pose[bone]) ?? ZERO;
  const editable = useEditor((s) => canEditPose(s.scene, mannequinId));
  const rom = getBoneRom(bone);
  const side = getBoneSide(bone);
  const s = () => store.getState();

  return (
    <section data-testid="bone-panel" aria-label="Joint" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{boneLabel(bone)}</h2>
        {!editable && <span className="text-[11px] text-amber-300">Locked</span>}
      </div>
      {rom.dofs.map((dof) => {
        const k = DOF_INDEX[dof];
        const [min, max] = rom.limits[k];
        const lbl = rom.labels[dof];
        return (
          <LabeledSlider
            key={dof}
            label={lbl?.title ?? dof}
            value={angles[k]}
            min={min}
            max={max}
            step={1}
            unit="°"
            ends={[`${lbl?.negative ?? ""} ${min}°`, `${max}° ${lbl?.positive ?? ""}`]}
            accent={DOF_COLORS[dof]}
            disabled={!editable}
            onChange={(v) => s().setBoneDof(mannequinId, bone, dof, v)}
            onGestureStart={() => s().beginGesture()}
            onGestureEnd={() => s().endGesture()}
            sliderTestId={`bone-slider-${dof}`}
            inputTestId={`bone-input-${dof}`}
          />
        );
      })}
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" data-testid="bone-reset" disabled={!editable} onClick={() => s().resetBones(mannequinId, [bone])}>
          <RotateCcw /> Reset joint
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="limb-reset"
          disabled={!editable}
          onClick={() => s().resetBones(mannequinId, limbOf(bone))}
        >
          <RotateCcw /> Reset limb
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="hand-reset"
          disabled={!editable}
          onClick={() => {
            const sides = side === "center" ? (["left", "right"] as const) : ([side] as const);
            s().resetBones(
              mannequinId,
              sides.flatMap((sd) => getBonesOf("hand", sd)) as PosableBoneName[],
            );
          }}
        >
          <RotateCcw /> Reset hand
        </Button>
      </div>
      <PoseActions mannequinId={mannequinId} editable={editable} />
    </section>
  );
}

export function PoseActions({ mannequinId, editable }: { mannequinId: string; editable: boolean }) {
  const store = useEditorStore();
  const s = () => store.getState();
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle>Whole pose</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" data-testid="pose-reset-default" disabled={!editable} onClick={() => s().resetPose(mannequinId, "default")}>
          Relaxed stand
        </Button>
        <Button variant="outline" size="sm" data-testid="pose-reset-neutral" disabled={!editable} onClick={() => s().resetPose(mannequinId, "neutral")}>
          Neutral
        </Button>
        <Button variant="outline" size="sm" data-testid="pose-mirror-l2r" disabled={!editable} onClick={() => s().mirrorPose(mannequinId, "left")}>
          Mirror L → R
        </Button>
        <Button variant="outline" size="sm" data-testid="pose-mirror-r2l" disabled={!editable} onClick={() => s().mirrorPose(mannequinId, "right")}>
          Mirror R → L
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="col-span-2"
          data-testid="pose-swap"
          disabled={!editable}
          onClick={() => s().swapSides(mannequinId)}
        >
          <FlipHorizontal2 /> Swap sides (flip pose)
        </Button>
      </div>
    </div>
  );
}
