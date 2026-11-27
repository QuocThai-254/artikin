"use client";

import { ArrowDownToLine, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getBodyPreset, BODY_PRESETS } from "@/lib/mannequin/presets/body";
import type { MaterialStyle } from "@/lib/mannequin/presets/types";
import { PROPORTION_PARAMS, resolveProportions } from "@/lib/mannequin/proportions";
import { MATERIAL_STYLES, type ProportionKey } from "@/lib/scene";
import { useEditor, useEditorStore } from "../store/context";
import { canEditPose } from "../store/guards";
import { FigureModelSection } from "../model-import/ui";
import { selectClass } from "./bone-picker";
import { NumberField, SectionTitle, TextField } from "./fields";
import { LabeledSlider } from "./labeled-slider";
import { PoseActions } from "./bone-panel";
import { SaveAsMyPresetButton } from "./presets/save-preset-dialog";

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const STYLE_LABEL: Record<MaterialStyle, string> = { wood: "Wood", clay: "Clay", toon: "Toon", plaster: "Plaster" };

export function FigurePanel({ mannequinId }: { mannequinId: string }) {
  const store = useEditorStore();
  const m = useEditor((s) => s.scene.mannequins.find((x) => x.id === mannequinId));
  const editable = useEditor((s) => canEditPose(s.scene, mannequinId));
  if (!m) return null;
  const s = () => store.getState();
  const preset = getBodyPreset(m.presetId);
  const p = resolveProportions(preset.proportions, m.proportions);
  // An imported model keeps its own look: body preset, material and proportions shape the mannequin only.
  const mannequinBody = !m.model;

  return (
    <section data-testid="figure-panel" aria-label="Figure" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <TextField
          label="Name"
          value={m.name}
          testId="figure-name-input"
          onCommit={(v) => s().renameMannequin(mannequinId, v)}
        />
        {mannequinBody && (
          <div className="flex flex-col gap-1">
            <label htmlFor="figure-preset" className="text-[11px] text-muted-foreground">
              Body preset
            </label>
            <select
              id="figure-preset"
              data-testid="figure-preset-select"
              className={selectClass}
              value={m.presetId}
              disabled={!editable}
              onChange={(e) => s().setBodyPreset(mannequinId, e.target.value)}
            >
              {BODY_PRESETS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!editable && <p className="text-[11px] text-amber-300">Pose locked — unlock to change pose, shape or position.</p>}
      </div>

      <FigureModelSection mannequinId={mannequinId} editable={editable} />

      {mannequinBody && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Material</SectionTitle>
          <div role="radiogroup" aria-label="Material style" className="grid grid-cols-4 gap-1">
            {MATERIAL_STYLES.map((style) => (
              <Button
                key={style}
                role="radio"
                aria-checked={m.material.style === style}
                data-testid={`material-style-${style}`}
                variant={m.material.style === style ? "secondary" : "ghost"}
                size="sm"
                onClick={() => s().setMaterial(mannequinId, { style })}
              >
                {STYLE_LABEL[style]}
              </Button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Tint</span>
            <input
              type="color"
              data-testid="material-color"
              aria-label="Tint color"
              className="h-7 w-14 cursor-pointer rounded border border-input bg-transparent"
              value={m.material.color}
              onChange={(e) => s().setMaterial(mannequinId, { color: e.target.value })}
            />
          </label>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionTitle>Placement</SectionTitle>
        <div className="grid grid-cols-4 gap-1.5">
          {(["x", "y", "z"] as const).map((axis, i) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              suffix="m"
              value={m.transform.position[i]}
              testId={`figure-position-${axis}`}
              disabled={!editable}
              onCommit={(v) => {
                const position = [...m.transform.position] as [number, number, number];
                position[i] = v;
                s().setMannequinTransform(mannequinId, { position });
              }}
            />
          ))}
          <NumberField
            label="Turn"
            suffix="°"
            digits={1}
            value={m.transform.rotation[1]}
            testId="figure-rotation-y"
            disabled={!editable}
            onCommit={(v) => s().setMannequinTransform(mannequinId, { rotation: [m.transform.rotation[0], v, m.transform.rotation[2]] })}
          />
        </div>
        <Button variant="outline" size="sm" data-testid="figure-drop-to-floor" disabled={!editable} onClick={() => s().dropToFloor(mannequinId)}>
          <ArrowDownToLine /> Drop to floor
        </Button>
      </div>

      {mannequinBody && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Proportions</SectionTitle>
            <Button variant="ghost" size="xs" disabled={!editable} onClick={() => s().resetProportions(mannequinId)}>
              <RotateCcw /> Preset values
            </Button>
          </div>
          {PROPORTION_PARAMS.map((param) => {
            const key = param.key as ProportionKey;
            const value = p[key];
            const format =
              key === "headSize"
                ? (v: number) => `${(1 / v).toFixed(1)} heads tall`
                : key === "height"
                  ? (v: number) => `${v.toFixed(2)} m`
                  : key === "muscularity"
                    ? (v: number) => `${Math.round(v * 100)} %`
                    : (v: number) => `${v.toFixed(2)}×`;
            return (
              <LabeledSlider
                key={key}
                label={`${param.label} · ${format(value)}`}
                value={value}
                min={param.min}
                max={param.max}
                step={param.step}
                format={format}
                withInput={false}
                disabled={!editable}
                onChange={(v) => s().setProportion(mannequinId, key, v)}
                onGestureStart={() => s().beginGesture()}
                onGestureEnd={() => s().endGesture()}
                sliderTestId={`proportion-slider-${kebab(key)}`}
              />
            );
          })}
        </div>
      )}

      <PoseActions mannequinId={mannequinId} editable={editable} />
      <SaveAsMyPresetButton mannequinId={mannequinId} testId="figure-save-preset" className="self-start" />
    </section>
  );
}
