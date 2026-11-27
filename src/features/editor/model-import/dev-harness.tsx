"use client";

/**
 * Development-only harness for the model import (S8): the real store, import pipeline, dialogs and
 * imported rig, rendered with the editor's own environment, floor and bulbs — before the editor
 * canvas wires the integration hooks. Test humanoids are generated in the browser (original
 * geometry, no third-party files). The route returns 404 in production builds.
 */

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { applyPoseToRig, applyTransformToRig } from "@/lib/mannequin/mesh/three-rig";
import { HAND_PRESETS } from "@/lib/mannequin/presets/hand";
import { POSE_PRESETS } from "@/lib/mannequin/presets/pose";
import { type HumanoidFixtureOptions, generateHumanoidFile } from "@/lib/model-import/testing/humanoid-fixture";
import { Floor, SceneEnvironment } from "../scene/environment";
import { LightBulbs } from "../scene/light-bulb";
import { patchPointShadowSampling } from "../scene/shadow-sampling";
import { fovFromFocalLength } from "../scene/three-helpers";
import { EditorStoreProvider, useEditor, useEditorStore } from "../store/context";
import { type EditorStore, createEditorStore } from "../store/editor-store";
import { applyModelToFigure } from "./apply-model";
import { useImportedModelAsset } from "./assets";
import { createImportedRig } from "./imported-rig";
import { importModelFile } from "./pipeline";
import { FigureModelSection } from "./figure-model-section";
import { ModelImportRoot } from "./model-import-root";

patchPointShadowSampling();

const GENERATED: { label: string; options: HumanoidFixtureOptions }[] = [
  { label: "VRM 1.0 · T-pose", options: { flavor: "vrm1" } },
  { label: "VRM 0.x · A-pose", options: { flavor: "vrm0", pose: "A" } },
  { label: "GLB · Mixamo names (cm)", options: { flavor: "mixamo", boneFrames: "along-bone", unitsPerMeter: 100 } },
  { label: "VRM 1.0 · no fingers/toes", options: { flavor: "vrm1", fingers: false, toes: false } },
];

function HarnessFigure({ id }: { id: string }) {
  const store = useEditorStore();
  const invalidate = useThree((s) => s.invalidate);
  const modelId = useEditor((s) => s.scene.mannequins.find((m) => m.id === id)?.model?.id);
  const asset = useImportedModelAsset(modelId);
  const rig = useMemo(() => (asset ? createImportedRig(asset, id) : null), [asset, id]);
  useEffect(() => () => rig?.dispose(), [rig]);
  useLayoutEffect(() => {
    if (!rig) return;
    const apply = () => {
      const m = store.getState().scene.mannequins.find((x) => x.id === id);
      if (!m) return;
      applyPoseToRig(rig, m.pose);
      applyTransformToRig(rig, m.transform);
      rig.root.updateMatrixWorld(true);
      rig.sync();
      const sel = store.getState().selection;
      rig.setHighlight(-1, -1, sel.kind === "mannequin" && sel.mannequinId === id);
      invalidate();
    };
    apply();
    return store.subscribe(apply);
  }, [store, rig, id, invalidate]);
  return rig ? <primitive object={rig.root} /> : null;
}

function HarnessScene() {
  const ids = useEditor((s) => s.scene.mannequins.map((m) => m.id).join(","));
  return (
    <>
      <SceneEnvironment />
      <Floor />
      <LightBulbs />
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <HarnessFigure key={id} id={id} />
        ))}
      <OrbitControls makeDefault target={[0, 1, 0]} enableDamping={false} />
    </>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function HarnessPanel({ store }: { store: EditorStore }) {
  const figureId = useEditor((s) => s.scene.mannequins[0]?.id ?? "");
  const locked = useEditor((s) => s.scene.lock.pose);
  const [busy, setBusy] = useState(false);

  const generate = async (options: HumanoidFixtureOptions) => {
    setBusy(true);
    try {
      const { bytes, fileName } = generateHumanoidFile(options);
      const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: "model/gltf-binary" });
      const { ref, asset } = await importModelFile(file);
      applyModelToFigure(store, figureId, ref, asset.proportions);
      toast.success(`${fileName} imported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const s = () => store.getState();
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3 text-sm" data-testid="harness-panel">
      <h1 className="text-base font-semibold">Model import harness (development only)</h1>
      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Generated test humanoids</h2>
        {GENERATED.map((g, i) => (
          <Button key={g.label} size="sm" variant="outline" disabled={busy} data-testid={`harness-generate-${i}`} onClick={() => void generate(g.options)}>
            {g.label}
          </Button>
        ))}
      </section>
      {figureId && <FigureModelSection mannequinId={figureId} editable={!locked} />}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Pose</h2>
        <div className="grid grid-cols-2 gap-1">
          {POSE_PRESETS.map((p) => (
            <Button key={p.id} size="xs" variant="ghost" data-testid={`harness-pose-${p.id}`} onClick={() => s().applyPosePreset(figureId, p)}>
              {p.name}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {HAND_PRESETS.slice(0, 4).map((h) => (
            <Button key={h.id} size="xs" variant="ghost" data-testid={`harness-hand-${h.id}`} onClick={() => s().applyHandPreset(figureId, h, "both")}>
              Hands: {h.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="outline" onClick={() => s().mirrorPose(figureId, "left")}>
            Mirror L→R
          </Button>
          <Button size="xs" variant="outline" onClick={() => s().undo()}>
            Undo
          </Button>
          <Button size="xs" variant="outline" onClick={() => s().redo()}>
            Redo
          </Button>
          <Button size="xs" variant={locked ? "secondary" : "outline"} data-testid="harness-lock" onClick={() => s().toggleMasterLock()}>
            {locked ? "Unlock" : "Lock"}
          </Button>
          <Button size="xs" variant="outline" onClick={() => s().resetPose(figureId, "default")}>
            Reset pose
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Lights &amp; export</h2>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="outline" onClick={() => s().updateLight("light_1", { position: [-1.4, 2.2, 1.2] })}>
            Key light left
          </Button>
          <Button size="xs" variant="outline" onClick={() => s().updateLight("light_1", { position: [1.1, 2.4, 0.9] })}>
            Key light right
          </Button>
          <Button
            size="xs"
            variant="outline"
            data-testid="harness-export"
            onClick={() => {
              const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=harness-canvas] canvas");
              canvas?.toBlob((b) => b && download(b, "artikin-model-import-harness.png"), "image/png");
            }}
          >
            Export PNG
          </Button>
        </div>
      </section>
    </aside>
  );
}

export default function ModelImportHarness() {
  const [store] = useState(() => createEditorStore());
  const camera = useMemo(() => store.getState().camera, [store]);
  useEffect(() => {
    (window as unknown as { __harnessStore?: EditorStore }).__harnessStore = store;
  }, [store]);
  return (
    <EditorStoreProvider value={store}>
      <div className="flex h-dvh bg-background text-foreground">
        <HarnessPanel store={store} />
        <main className="relative min-w-0 flex-1" data-testid="harness-canvas">
          <Canvas
            shadows="percentage"
            frameloop="demand"
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            camera={{ position: [2.6, 1.7, 3.8], fov: fovFromFocalLength(camera.focalLength), near: 0.03, far: 300 }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.NeutralToneMapping;
              gl.outputColorSpace = THREE.SRGBColorSpace;
            }}
          >
            <HarnessScene />
          </Canvas>
        </main>
        <ModelImportRoot />
        <Toaster />
      </div>
    </EditorStoreProvider>
  );
}
