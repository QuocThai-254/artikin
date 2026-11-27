"use client";

import { Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEditor, useEditorStore } from "../store/context";
import { canEditLights } from "../store/guards";
import { NumberField, SectionTitle, TextField } from "./fields";
import { LabeledSlider } from "./labeled-slider";

export function LightPanel({ lightId }: { lightId: string }) {
  const store = useEditorStore();
  const light = useEditor((s) => s.scene.lights.find((l) => l.id === lightId));
  const editable = useEditor((s) => canEditLights(s.scene));
  const casters = useEditor((s) => s.scene.lights.filter((l) => l.castShadow).length);
  if (!light) return null;
  const s = () => store.getState();
  const update = (patch: Parameters<ReturnType<typeof store.getState>["updateLight"]>[1]) => s().updateLight(lightId, patch);

  return (
    <section data-testid="light-panel" aria-label="Light" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <TextField label="Name" value={light.name} testId="light-name-input" disabled={!editable} onCommit={(v) => update({ name: v })} />
        {!editable && <p className="text-[11px] text-amber-300">Lights locked — unlock to edit.</p>}
      </div>
      <LabeledSlider
        label="Intensity"
        value={Math.round(light.intensity * 100)}
        min={0}
        max={100}
        unit=" %"
        disabled={!editable}
        sliderTestId="light-intensity"
        inputTestId="light-intensity-input"
        onChange={(v) => update({ intensity: v / 100 })}
        onGestureStart={() => s().beginGesture()}
        onGestureEnd={() => s().endGesture()}
      />
      <div className="flex flex-col gap-2">
        <LabeledSlider
          label="Color temperature"
          value={light.colorTemperature ?? 6500}
          min={2000}
          max={10000}
          step={100}
          unit=" K"
          ends={["Warm 2000 K", "Cool 10000 K"]}
          disabled={!editable}
          sliderTestId="light-temperature"
          onChange={(v) => update({ colorTemperature: v })}
          onGestureStart={() => s().beginGesture()}
          onGestureEnd={() => s().endGesture()}
        />
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Custom color{light.colorTemperature === null ? " (in use)" : ""}</span>
          <input
            type="color"
            data-testid="light-color"
            aria-label="Light color"
            disabled={!editable}
            className="h-7 w-14 cursor-pointer rounded border border-input bg-transparent disabled:opacity-50"
            value={light.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle>Shadows</SectionTitle>
        <label className="flex items-center justify-between gap-2 text-sm">
          Cast shadows
          <Switch
            data-testid="light-cast-shadow"
            checked={light.castShadow}
            disabled={!editable}
            onCheckedChange={(v) => update({ castShadow: v })}
          />
        </label>
        {casters > 2 && light.castShadow && (
          <p data-testid="light-shadow-warning" role="status" className="flex items-center gap-1.5 text-[11px] text-amber-300">
            <TriangleAlert className="size-3.5" /> More than two shadow-casting lights can slow down rendering.
          </p>
        )}
        <LabeledSlider
          label="Softness"
          value={Math.round(light.shadowSoftness * 100)}
          min={0}
          max={100}
          unit=" %"
          withInput={false}
          disabled={!editable || !light.castShadow}
          sliderTestId="light-softness"
          onChange={(v) => update({ shadowSoftness: v / 100 })}
          onGestureStart={() => s().beginGesture()}
          onGestureEnd={() => s().endGesture()}
        />
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle>Position</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5">
          {(["x", "y", "z"] as const).map((axis, i) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              suffix="m"
              value={light.position[i]}
              testId={`light-position-${axis}`}
              disabled={!editable}
              onCommit={(v) => {
                const position = [...light.position] as [number, number, number];
                position[i] = v;
                update({ position });
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Switch data-testid="light-visible" checked={light.visible} disabled={!editable} onCheckedChange={(v) => update({ visible: v })} />
          Light on
        </label>
        <Button variant="destructive" size="sm" disabled={!editable} onClick={() => s().removeLight(lightId)}>
          <Trash2 /> Delete
        </Button>
      </div>
    </section>
  );
}
