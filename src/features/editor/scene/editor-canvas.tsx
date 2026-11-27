"use client";

import { Canvas, events as pointerEvents } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { QUALITY_PROFILES } from "../lib/render-quality";
import { useRenderQuality } from "../lib/view-prefs";
import { useEditorStore } from "../store/context";
import { AdaptiveResolution, GestureTracking } from "./adaptive-resolution";
import { BoneGizmo } from "./bone-gizmo";
import { CameraRig } from "./camera-rig";
import { CaptureController } from "./capture-controller";
import { EngineBridge } from "./engine-bridge";
import { Floor, SceneEnvironment } from "./environment";
import { IkHandles } from "./ik-handles";
import { InteractionProvider, InteractionTracker } from "./interaction";
import { LightBulbs } from "./light-bulb";
import { Mannequins } from "./mannequin";
import { MoveGizmo } from "./move-gizmo";
import { OverlayProgramCache } from "./overlay-program-cache";
import { RigRegistry, RigRegistryProvider } from "./rig-registry";
import { ShadowCache } from "./shadow-cache";
import { patchPointShadowSampling } from "./shadow-sampling";
import { fovFromFocalLength } from "./three-helpers";

// Smooth point-light penumbrae (before any shader compiles; this module only loads in the browser).
patchPointShadowSampling();

/**
 * R3F pointer events that skip hover picking while a drag or an orbit holds the pointer: those moves
 * only feed the captured target (which reads `e.ray`), so a zero layer mask — matching no object —
 * saves a raycast against every interactive object on every move (ARCHITECTURE §9.8).
 */
function editorPointerEvents(tracker: InteractionTracker): typeof pointerEvents {
  return (store) => {
    const base = pointerEvents(store);
    const pickMask = store.getState().raycaster.layers.mask;
    return {
      ...base,
      compute(event, state, previous) {
        base.compute?.(event, state, previous);
        state.raycaster.layers.mask = tracker.pointerBusy ? 0 : pickMask;
      },
    };
  };
}

/**
 * The 3D viewport (client-only; loaded with `next/dynamic` + `ssr: false`). Render on demand:
 * frames are only drawn after a state change; shadows are cached and the resolution adapts while
 * interacting (ARCHITECTURE §9.8).
 */
export function EditorCanvas() {
  const store = useEditorStore();
  const registry = useMemo(() => new RigRegistry(), []);
  const tracker = useMemo(() => new InteractionTracker(), []);
  const events = useMemo(() => editorPointerEvents(tracker), [tracker]);
  const initialCamera = useMemo(() => store.getState().camera, [store]);
  const quality = useRenderQuality();
  const profile = QUALITY_PROFILES[quality];
  useEffect(() => () => tracker.dispose(), [tracker]);

  return (
    <Canvas
      // Antialiasing is fixed when the WebGL context is created: switching it remounts the canvas.
      key={profile.antialias ? "msaa" : "no-msaa"}
      shadows="percentage"
      frameloop="demand"
      dpr={[0.5, profile.maxPixelRatio]}
      events={events}
      gl={{ antialias: profile.antialias, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: initialCamera.position, fov: fovFromFocalLength(initialCamera.focalLength), near: 0.03, far: 300 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      onPointerMissed={(e) => {
        if (e.button !== 0) return;
        const state = store.getState();
        if (!state.gestureActive) state.clearSelection();
      }}
    >
      <InteractionProvider value={tracker}>
        <RigRegistryProvider value={registry}>
          <ShadowCache />
          <OverlayProgramCache />
          <GestureTracking />
          <AdaptiveResolution quality={quality} />
          <SceneEnvironment />
          <Floor />
          <LightBulbs />
          <Mannequins />
          <BoneGizmo />
          <IkHandles />
          <MoveGizmo />
          <CameraRig />
          <CaptureController />
          <EngineBridge />
        </RigRegistryProvider>
      </InteractionProvider>
    </Canvas>
  );
}

export default EditorCanvas;
