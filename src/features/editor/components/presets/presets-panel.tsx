"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Side } from "@/lib/mannequin/pose-math";
import { BODY_PRESETS } from "@/lib/mannequin/presets/body";
import { HAND_PRESETS } from "@/lib/mannequin/presets/hand";
import { POSE_CATEGORY_LABELS, POSE_PRESETS } from "@/lib/mannequin/presets/pose";
import type { PosePreset } from "@/lib/mannequin/presets/types";
import { cn } from "@/lib/utils";
import { useEditor, useEditorStore } from "../../store/context";
import { canEditPose } from "../../store/guards";
import { useActiveMannequinId } from "../bone-picker";
import { SectionTitle } from "../fields";
import { MyPresetsTab } from "./my-presets-tab";
import { PresetPreview } from "./preset-preview";
import { bodyPreview, handPreview, posePreview } from "./preview-shapes";

type HandTarget = Side | "both";

const HAND_TARGETS: readonly { value: HandTarget; label: string }[] = [
  { value: "left", label: "Left hand" },
  { value: "right", label: "Right hand" },
  { value: "both", label: "Both hands" },
];

const CATEGORIES = Object.keys(POSE_CATEGORY_LABELS) as PosePreset["category"][];

/** Tile: preview icon above the preset name; the visible name is the button's accessible name. */
const TILE =
  "h-auto flex-col items-stretch gap-1 px-1 pt-1 pb-1.5 text-[11px] leading-tight font-normal whitespace-normal aria-pressed:border-primary aria-pressed:bg-muted";
/** `size-auto` opts the icon out of the button's default 16 px svg size. */
const PREVIEW_BOX = "size-auto w-full rounded-md bg-muted text-foreground/85";

/**
 * Presets panel (PROJECT F10, PROGRESS C-05): pose, hand and body presets for the active figure.
 * Applying a preset is one undo step (store actions); everything is disabled while the figure's
 * pose is locked (PROJECT §10). Body presets only shape the procedural mannequin, so they are
 * disabled (with a hint) while the figure shows an imported model (`model` set, S8); pose and
 * hand presets drive the skeleton and keep working. "Mine" holds the user's personal presets
 * (PROJECT F15, `my-presets-tab.tsx`). Test ids: TEST_PLAN §6.2.
 */
export function PresetsPanel() {
  const store = useEditorStore();
  const mannequinId = useActiveMannequinId();
  const figureName = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.name ?? null);
  const bodyPresetId = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.presetId ?? null);
  const hasModel = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.model !== undefined);
  const editable = useEditor((s) => (mannequinId ? canEditPose(s.scene, mannequinId) : false));
  const [target, setTarget] = useState<HandTarget>("both");
  if (!mannequinId || figureName === null) return null;
  const actions = () => store.getState();

  return (
    <section data-testid="presets-panel" aria-label="Presets" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>Presets</SectionTitle>
        <span className="truncate text-[11px] text-muted-foreground" title={`Presets apply to ${figureName}`}>
          {figureName}
        </span>
      </div>
      {!editable && <p className="text-[11px] text-amber-300">Pose locked — unlock to apply presets.</p>}
      <Tabs defaultValue="pose" className="gap-3">
        <TabsList className="w-full">
          <TabsTrigger value="pose" data-testid="presets-tab-pose">
            Pose
          </TabsTrigger>
          <TabsTrigger value="hands" data-testid="presets-tab-hands">
            Hands
          </TabsTrigger>
          <TabsTrigger value="body" data-testid="presets-tab-body">
            Body
          </TabsTrigger>
          <TabsTrigger value="mine" data-testid="presets-tab-mine">
            Mine
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pose" className="flex flex-col gap-3">
          {CATEGORIES.map((category) => {
            const presets = POSE_PRESETS.filter((p) => p.category === category);
            if (presets.length === 0) return null;
            return (
              <div key={category} role="group" aria-label={POSE_CATEGORY_LABELS[category]} className="flex flex-col gap-1.5">
                <h4 className="text-[11px] text-muted-foreground">{POSE_CATEGORY_LABELS[category]}</h4>
                <div className="grid grid-cols-3 gap-1.5">
                  {presets.map((preset) => (
                    <Button
                      key={preset.id}
                      variant="outline"
                      className={TILE}
                      data-testid={`pose-preset-${preset.id}`}
                      disabled={!editable}
                      onClick={() => actions().applyPosePreset(mannequinId, preset)}
                    >
                      <PresetPreview preview={posePreview(preset)} className={cn(PREVIEW_BOX, "aspect-[5/4]")} />
                      <span>{preset.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="hands" className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Apply hand presets to" className="grid grid-cols-3 gap-1">
            {HAND_TARGETS.map((t) => (
              <Button
                key={t.value}
                role="radio"
                aria-checked={target === t.value}
                size="xs"
                variant={target === t.value ? "secondary" : "ghost"}
                data-testid={`hand-preset-target-${t.value}`}
                onClick={() => setTarget(t.value)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {HAND_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant="outline"
                className={TILE}
                data-testid={`hand-preset-${preset.id}`}
                disabled={!editable}
                onClick={() => actions().applyHandPreset(mannequinId, preset, target)}
              >
                <PresetPreview preview={handPreview(preset)} className={cn(PREVIEW_BOX, "aspect-[5/4]")} />
                <span>{preset.name}</span>
              </Button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="body" className="flex flex-col gap-2">
          {hasModel ? (
            <p data-testid="presets-body-model-hint" className="text-[11px] text-muted-foreground">
              Body presets apply to the mannequin — switch back to the mannequin in the figure panel to use them.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Generic body types, drawn to scale. Changing the body keeps the pose.</p>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {BODY_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant="outline"
                className={TILE}
                aria-pressed={bodyPresetId === preset.id}
                title={preset.description}
                data-testid={`body-preset-${preset.id}`}
                disabled={!editable || hasModel}
                onClick={() => actions().setBodyPreset(mannequinId, preset.id)}
              >
                <PresetPreview preview={bodyPreview(preset)} className={cn(PREVIEW_BOX, "h-24")} />
                <span>{preset.name}</span>
              </Button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="mine" className="flex flex-col gap-2">
          <MyPresetsTab mannequinId={mannequinId} editable={editable} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
