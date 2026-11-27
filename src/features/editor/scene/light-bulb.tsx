"use client";

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneLight, ShadowQuality } from "@/lib/scene";
import { shadowMapSize } from "../lib/render-quality";
import { useRenderQuality } from "../lib/view-prefs";
import { useEditor, useEditorStore } from "../store/context";
import type { EditorState } from "../store/editor-store";
import { canEditLights } from "../store/guards";
import { setControlsEnabled, setCursor } from "./three-helpers";

/** Normalized intensity 1.0 → point light intensity (candela, decay 2). Tuned visually. */
export const MAX_BULB_INTENSITY = 55;
export const SHADOW_MAP_SIZE: Readonly<Record<ShadowQuality, number>> = { low: 512, medium: 1024, high: 2048 };
const BULB_RADIUS = 0.055;
const BULB_HIT_RADIUS = 0.09;

export function LightBulb({ id }: { id: string }) {
  const store = useEditorStore();
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const gl = useThree((s) => s.gl);
  const castShadow = useEditor((s) => s.scene.lights.find((l) => l.id === id)?.castShadow ?? false);
  const visible = useEditor((s) => s.scene.lights.find((l) => l.id === id)?.visible ?? true);
  const quality = useEditor((s) => s.scene.environment.shadowQuality);
  const renderQuality = useRenderQuality();
  // The scene's shadow quality, capped by this device's rendering quality preference.
  const mapSize = shadowMapSize(SHADOW_MAP_SIZE[quality], renderQuality);
  const selected = useEditor((s) => s.selection.kind === "light" && s.selection.lightId === id);

  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const glass = useRef<THREE.MeshBasicMaterial>(null);
  const drag = useRef<{ plane: THREE.Plane; offset: THREE.Vector3; pointerId: number } | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // Imperative updates for position / intensity / color / softness (no React re-render per drag frame).
  useLayoutEffect(() => {
    let last: SceneLight | null = null;
    const apply = (state: EditorState) => {
      const l = state.scene.lights.find((x) => x.id === id);
      if (!l || l === last || !group.current || !light.current || !glass.current) return;
      last = l;
      group.current.position.set(l.position[0], l.position[1], l.position[2]);
      light.current.intensity = l.intensity * MAX_BULB_INTENSITY;
      light.current.color.set(l.color);
      // Wider PCF kernels sample farther from the receiver → scale the normal offset with the
      // kernel and the texel size so grazing surfaces don't show acne.
      const shadow = light.current.shadow;
      shadow.radius = 1 + l.shadowSoftness * 6;
      shadow.blurSamples = 8 + Math.round(l.shadowSoftness * 12);
      shadow.normalBias = (0.014 + 0.02 * l.shadowSoftness) * Math.sqrt(1024 / mapSize);
      shadow.bias = -0.0004;
      const glow = new THREE.Color(l.color).lerp(new THREE.Color("#ffffff"), 0.35);
      glass.current.color.copy(glow).multiplyScalar(0.35 + 0.9 * l.intensity);
      invalidate();
    };
    apply(store.getState());
    return store.subscribe(apply);
  }, [store, id, invalidate, mapSize]);

  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    if (l.shadow.mapSize.x !== mapSize) {
      l.shadow.mapSize.set(mapSize, mapSize);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
    l.shadow.camera.near = 0.05;
    l.shadow.camera.far = 40;
    invalidate();
  }, [mapSize, castShadow, invalidate]);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = store.getState();
    if (!canEditLights(state.scene)) {
      state.notify("Lights locked — unlock to move bulbs", "warning", "lock");
      return;
    }
    state.select({ kind: "light", lightId: id });
    const pos = group.current?.getWorldPosition(new THREE.Vector3());
    if (!pos) return;
    const normal = e.shiftKey
      ? new THREE.Vector3(0, 1, 0)
      : camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pos);
    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    drag.current = { plane, offset: pos.clone().sub(hit), pointerId: e.pointerId };
    setControlsEnabled(controls, false);
    state.beginGesture();
    setCursor(gl.domElement, "grabbing");
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const state = store.getState();
    if (!drag.current) {
      if (!state.gestureActive) {
        e.stopPropagation();
        setCursor(gl.domElement, canEditLights(state.scene) ? "grab" : "not-allowed");
        state.setHover({ kind: "light", lightId: id });
      }
      return;
    }
    e.stopPropagation();
    const hit = e.ray.intersectPlane(drag.current.plane, tmp);
    if (!hit) return;
    const p = hit.add(drag.current.offset);
    state.updateLight(id, { position: [p.x, Math.max(0.05, p.y), p.z] });
  };

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    (e.target as unknown as Element).releasePointerCapture?.(drag.current.pointerId);
    drag.current = null;
    setControlsEnabled(controls, true);
    store.getState().endGesture();
    setCursor(gl.domElement, "");
  };

  const onPointerOut = () => {
    const state = store.getState();
    if (state.hover?.kind === "light" && state.hover.lightId === id) state.setHover(null);
    if (!drag.current) setCursor(gl.domElement, "");
  };

  return (
    <group ref={group} visible={visible} name={`light-${id}`}>
      <pointLight ref={light} castShadow={castShadow} decay={2} distance={0} />
      <group userData={{ artikinRole: "bulb" }}>
        <mesh castShadow={false} receiveShadow={false} raycast={() => null}>
          <sphereGeometry args={[BULB_RADIUS, 24, 16]} />
          <meshBasicMaterial ref={glass} toneMapped={false} />
        </mesh>
        <mesh position={[0, BULB_RADIUS * 1.05, 0]} castShadow={false} raycast={() => null}>
          <cylinderGeometry args={[BULB_RADIUS * 0.45, BULB_RADIUS * 0.55, BULB_RADIUS * 0.9, 16]} />
          <meshStandardMaterial color="#3b3e45" roughness={0.5} metalness={0.6} />
        </mesh>
        {/* Invisible, larger pick target so the small bulb is easy to grab. */}
        <mesh
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerOut={onPointerOut}
          onClick={(e) => e.stopPropagation()}
          castShadow={false}
          receiveShadow={false}
          name="bulb"
          userData={{ lightId: id }}
        >
          <sphereGeometry args={[BULB_HIT_RADIUS, 16, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>
      {selected && (
        <mesh userData={{ artikinRole: "helper" }} raycast={() => null} renderOrder={10}>
          <torusGeometry args={[BULB_RADIUS * 2.1, BULB_RADIUS * 0.12, 8, 48]} />
          <meshBasicMaterial color="#ffd43b" depthTest={false} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

export function LightBulbs() {
  const ids = useEditor((s) => s.scene.lights.map((l) => l.id).join(","));
  return (
    <>
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <LightBulb key={id} id={id} />
        ))}
    </>
  );
}
