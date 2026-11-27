"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useEditor } from "../store/context";
import { BonePanel } from "./bone-panel";
import { BonePicker } from "./bone-picker";
import { FigurePanel } from "./figure-panel";
import { LightPanel } from "./light-panel";
import { PresetsPanel } from "./presets/presets-panel";
import { ScenePanel } from "./scene-panel";

/** Contextual properties (PROJECT §13.1): joint · figure · light · scene. */
export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  return (
    <aside aria-label="Properties" className="flex h-full min-h-0 flex-col border-l border-border bg-card/60">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <BonePicker />
          <Separator />
          {selection.kind === "bone" && <BonePanel key={`${selection.mannequinId}:${selection.bone}`} mannequinId={selection.mannequinId} bone={selection.bone} />}
          {selection.kind === "mannequin" && <FigurePanel key={selection.mannequinId} mannequinId={selection.mannequinId} />}
          {selection.kind === "light" && <LightPanel key={selection.lightId} lightId={selection.lightId} />}
          {selection.kind === "none" && <ScenePanel />}
          <Separator />
          <PresetsPanel />
        </div>
      </ScrollArea>
    </aside>
  );
}
