"use client";

import { Lock } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { SHADOW_QUALITIES } from "@/lib/scene";
import { QUALITY_PROFILES, RENDER_QUALITIES, isRenderQuality } from "../lib/render-quality";
import { setRenderQuality, useRenderQuality } from "../lib/view-prefs";
import { useEditor, useEditorStore } from "../store/context";
import { selectClass } from "./bone-picker";
import { SectionTitle } from "./fields";
import { LabeledSlider } from "./labeled-slider";
import { VIEW_LOCKED_HINT } from "./view-controls";

export function ScenePanel() {
  const store = useEditorStore();
  const env = useEditor((s) => s.scene.environment);
  const focal = useEditor((s) => s.camera.focalLength);
  const turntable = useEditor((s) => s.turntable);
  const viewLocked = useEditor((s) => s.scene.lock.view);
  const renderQuality = useRenderQuality();
  const s = () => store.getState();

  return (
    <section aria-label="Scene" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SectionTitle>Lighting</SectionTitle>
        <LabeledSlider
          label="Ambient fill"
          value={Math.round(env.ambient * 100)}
          min={0}
          max={100}
          unit=" %"
          ends={["Deep shadows", "Soft shadows"]}
          sliderTestId="scene-ambient"
          onChange={(v) => s().setEnvironment({ ambient: v / 100 })}
          onGestureStart={() => s().beginGesture()}
          onGestureEnd={() => s().endGesture()}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="shadow-quality" className="text-[11px] text-muted-foreground">
            Shadow quality
          </label>
          <select
            id="shadow-quality"
            data-testid="scene-shadow-quality"
            className={selectClass}
            value={env.shadowQuality}
            onChange={(e) => s().setEnvironment({ shadowQuality: e.target.value as (typeof SHADOW_QUALITIES)[number] })}
          >
            {SHADOW_QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q[0].toUpperCase() + q.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle>Floor & background</SectionTitle>
        <label className="flex items-center justify-between text-sm">
          Floor
          <Switch data-testid="scene-floor-visible" checked={env.floor.visible} onCheckedChange={(v) => s().setEnvironment({ floor: { ...env.floor, visible: v } })} />
        </label>
        <label className="flex items-center justify-between text-sm">
          Grid
          <Switch data-testid="scene-grid-visible" checked={env.floor.grid} onCheckedChange={(v) => s().setEnvironment({ floor: { ...env.floor, grid: v } })} />
        </label>
        <label className="flex items-center justify-between text-sm">
          Shadow-only floor
          <Switch
            data-testid="scene-shadow-only-floor"
            checked={env.floor.shadowOnly}
            onCheckedChange={(v) => s().setEnvironment({ floor: { ...env.floor, shadowOnly: v } })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Background
          <input
            type="color"
            data-testid="scene-background"
            aria-label="Background color"
            className="h-7 w-14 cursor-pointer rounded border border-input bg-transparent"
            value={env.background}
            onChange={(e) => s().setEnvironment({ background: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitle>Camera</SectionTitle>
        {viewLocked && (
          <p data-testid="camera-view-locked" className="flex items-center gap-1 text-[11px] text-amber-300">
            <Lock className="size-3" aria-hidden />
            {VIEW_LOCKED_HINT}
          </p>
        )}
        <LabeledSlider
          label="Focal length"
          value={focal}
          min={18}
          max={200}
          unit=" mm"
          ends={["Wide 18 mm", "Tele 200 mm"]}
          disabled={viewLocked}
          sliderTestId="camera-focal-length"
          inputTestId="camera-focal-length-input"
          onChange={(v) => s().setCamera({ focalLength: Math.round(Math.min(200, Math.max(18, v))) })}
        />
        <label className="flex items-center justify-between text-sm">
          Turntable (T)
          <Switch
            data-testid="camera-turntable"
            checked={turntable.enabled}
            disabled={viewLocked}
            onCheckedChange={(v) => s().setTurntable({ enabled: v })}
          />
        </label>
        <LabeledSlider
          label="Turntable speed"
          value={turntable.speed}
          min={0.2}
          max={4}
          step={0.1}
          unit="×"
          withInput={false}
          sliderTestId="camera-turntable-speed"
          onChange={(v) => s().setTurntable({ speed: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <SectionTitle>Display</SectionTitle>
        <label htmlFor="render-quality" className="text-[11px] text-muted-foreground">
          Rendering quality (this device)
        </label>
        <select
          id="render-quality"
          data-testid="scene-render-quality"
          aria-describedby="render-quality-hint"
          className={selectClass}
          value={renderQuality}
          onChange={(e) => {
            if (isRenderQuality(e.target.value)) setRenderQuality(e.target.value);
          }}
        >
          {RENDER_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {QUALITY_PROFILES[q].label}
            </option>
          ))}
        </select>
        <p id="render-quality-hint" className="text-[11px] text-muted-foreground">
          {QUALITY_PROFILES[renderQuality].description}
        </p>
      </div>
    </section>
  );
}
