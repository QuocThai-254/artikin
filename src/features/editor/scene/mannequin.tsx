"use client";

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getFigureModel } from "@/lib/mannequin/figure-model";
import { TOON_OUTLINE_COLOR, TOON_OUTLINE_PX, createFigureMaterial, createHighlightUniforms } from "@/lib/mannequin/materials";
import { BONE_INDEX } from "@/lib/mannequin/mesh/build";
import {
  type MannequinRig,
  addOutline,
  applyPoseToRig,
  applyTransformToRig,
  boneFromFace,
  createOutlineMaterial,
  createRig,
  updateRigBounds,
} from "@/lib/mannequin/mesh/three-rig";
import type { MaterialStyle } from "@/lib/mannequin/presets/types";
import { isPosableBone } from "@/lib/mannequin/rom";
import { createImportedRig, isImportedRig, useImportedModelAsset } from "../model-import/scene";
import { useEditor, useEditorStore } from "../store/context";
import type { EditorState } from "../store/editor-store";
import { canEditPose } from "../store/guards";
import { useRigRegistry } from "./rig-registry";
import { setControlsEnabled, setCursor, setHighlight, setMaterialColor, setObjectVisible, setViewport } from "./three-helpers";

const outlineViewport = { value: new THREE.Vector2(1, 1) };

/** Toon outline width reference (drawing-buffer px at rest); kept by the adaptive resolution. */
export function syncOutlineViewport(width: number, height: number) {
  setViewport(outlineViewport, width, height);
}

export function Mannequin({ id }: { id: string }) {
  const store = useEditorStore();
  const registry = useRigRegistry();
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);

  const presetId = useEditor((s) => s.scene.mannequins.find((m) => m.id === id)?.presetId ?? "classic-wooden");
  const proportionsJson = useEditor((s) => JSON.stringify(s.scene.mannequins.find((m) => m.id === id)?.proportions ?? {}));
  const style = useEditor((s) => s.scene.mannequins.find((m) => m.id === id)?.material.style ?? "wood") as MaterialStyle;
  const color = useEditor((s) => s.scene.mannequins.find((m) => m.id === id)?.material.color ?? "#d9b48f");
  const visible = useEditor((s) => s.scene.mannequins.find((m) => m.id === id)?.visible ?? true);
  const modelId = useEditor((s) => s.scene.mannequins.find((m) => m.id === id)?.model?.id);
  // The figure's imported model once loaded on this device (S8, ARCHITECTURE §9.11); null = mannequin.
  const asset = useImportedModelAsset(modelId);

  const model = useMemo(() => getFigureModel(presetId, JSON.parse(proportionsJson)), [presetId, proportionsJson]);
  const uniforms = useMemo(() => createHighlightUniforms(), []);
  const material = useMemo(() => createFigureMaterial(style, "#ffffff", uniforms), [style, uniforms]);
  const outlineMaterial = useMemo(
    () => (style === "toon" ? createOutlineMaterial(TOON_OUTLINE_COLOR, TOON_OUTLINE_PX, outlineViewport) : null),
    [style],
  );
  const importedRig = useMemo(() => (asset ? createImportedRig(asset, id) : null), [asset, id]);
  const rig = useMemo<MannequinRig>(() => {
    // An imported model keeps its own look: preset, proportions and material don't rebuild it.
    if (importedRig) return importedRig;
    const r = createRig(model, material);
    r.root.userData.mannequinId = id;
    r.mesh.userData.mannequinId = id;
    if (outlineMaterial) addOutline(r, outlineMaterial);
    return r;
  }, [importedRig, model, material, outlineMaterial, id]);

  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => outlineMaterial?.dispose(), [outlineMaterial]);

  // Tint (no material rebuild).
  useLayoutEffect(() => {
    setMaterialColor(material, color);
    invalidate();
  }, [material, color, invalidate]);

  // Pose & transform: imperative, outside React renders.
  useLayoutEffect(() => {
    registry.set(id, rig);
    let lastPose: unknown = null;
    let lastTransform: unknown = null;
    const apply = (state: EditorState) => {
      const m = state.scene.mannequins.find((x) => x.id === id);
      if (!m) return;
      let changed = false;
      let posed = false;
      if (m.pose !== lastPose) {
        applyPoseToRig(rig, m.pose);
        lastPose = m.pose;
        changed = true;
        posed = true;
      }
      if (m.transform !== lastTransform) {
        applyTransformToRig(rig, m.transform);
        lastTransform = m.transform;
        changed = true;
      }
      if (changed) {
        rig.root.updateMatrixWorld(true);
        // Imported model: retarget its own skeleton from the proxy bones just posed.
        if (posed && isImportedRig(rig)) rig.sync();
        updateRigBounds(rig);
        invalidate();
      }
    };
    apply(store.getState());
    const unsub = store.subscribe(apply);
    return () => {
      unsub();
      registry.delete(id, rig);
    };
  }, [store, rig, id, registry, invalidate]);

  // Selection / hover highlight through shader uniforms.
  useLayoutEffect(() => {
    const apply = (state: EditorState) => {
      const sel = state.selection;
      const hov = state.hover;
      const selected = sel.kind === "bone" && sel.mannequinId === id ? BONE_INDEX[sel.bone] : -1;
      const all = sel.kind === "mannequin" && sel.mannequinId === id;
      const hover = hov && hov.kind === "bone" && hov.mannequinId === id ? BONE_INDEX[hov.bone] : -1;
      const changed = isImportedRig(rig) ? rig.setHighlight(selected, hover, all) : setHighlight(uniforms, selected, hover, all);
      if (changed) invalidate();
    };
    apply(store.getState());
    return store.subscribe(apply);
  }, [store, uniforms, rig, id, invalidate]);

  useLayoutEffect(() => {
    setObjectVisible(rig.root, visible);
    invalidate();
  }, [rig, visible, invalidate]);

  const pickBone = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (!e.face || e.object !== rig.mesh) return null;
    return boneFromFace(rig.mesh.geometry, e.face.a);
  };

  /** Gizmo rings, IK handles and the turn ring draw over the body, so they win its pointer events. */
  const overlayHit = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.intersections.some((i) => i.object.userData.overlay === true);

  // Move tool: drag the body across the floor (Shift: lift vertically). One drag = one undo step.
  const moveDrag = useRef<{ pointerId: number; plane: THREE.Plane; offset: THREE.Vector3; vertical: boolean } | null>(null);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const state = store.getState();
    if (e.button !== 0 || state.tool !== "move" || overlayHit(e) || !pickBone(e)) return;
    if (!canEditPose(state.scene, id)) return;
    const m = state.scene.mannequins.find((x) => x.id === id);
    if (!m) return;
    e.stopPropagation();
    const hips = new THREE.Vector3(...m.transform.position);
    const vertical = e.nativeEvent.shiftKey;
    const plane = new THREE.Plane();
    if (vertical) {
      const n = camera.getWorldDirection(new THREE.Vector3()).setY(0);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      plane.setFromNormalAndCoplanarPoint(n.normalize().negate(), e.point);
    } else {
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), e.point);
    }
    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    state.select({ kind: "mannequin", mannequinId: id });
    moveDrag.current = { pointerId: e.pointerId, plane, offset: hips.sub(hit), vertical };
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    setControlsEnabled(controls, false);
    state.beginGesture();
    setCursor(gl.domElement, "grabbing");
  };

  const endMoveDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = moveDrag.current;
    if (!d) return;
    e.stopPropagation();
    (e.target as unknown as Element).releasePointerCapture?.(d.pointerId);
    moveDrag.current = null;
    setControlsEnabled(controls, true);
    store.getState().endGesture();
    setCursor(gl.domElement, "");
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const state = store.getState();
    const d = moveDrag.current;
    if (d) {
      e.stopPropagation();
      const hit = e.ray.intersectPlane(d.plane, new THREE.Vector3());
      const m = state.scene.mannequins.find((x) => x.id === id);
      if (!hit || !m) return;
      const p = hit.add(d.offset);
      const [x, y, z] = m.transform.position;
      state.setMannequinTransform(id, { position: d.vertical ? [x, Math.max(0, p.y), z] : [p.x, y, p.z] });
      return;
    }
    if (state.gestureActive) return;
    if (overlayHit(e)) {
      const h = state.hover;
      if (h && h.kind === "bone" && h.mannequinId === id) state.setHover(null);
      return;
    }
    const bone = pickBone(e);
    if (!bone) return;
    e.stopPropagation();
    const el = gl.domElement;
    if (!canEditPose(state.scene, id)) {
      setCursor(el, "not-allowed");
      state.setHover(null);
      return;
    }
    if (state.tool === "move") {
      setCursor(el, "move");
      state.setHover(null);
      return;
    }
    setCursor(el, "pointer");
    state.setHover({ kind: "bone", mannequinId: id, bone });
  };

  const onPointerOut = () => {
    const state = store.getState();
    const h = state.hover;
    if (h && h.kind === "bone" && h.mannequinId === id) state.setHover(null);
    if (!state.gestureActive) setCursor(gl.domElement, "");
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || overlayHit(e)) return; // orbit drag or a click on a gizmo/handle
    const bone = pickBone(e);
    if (!bone) return;
    e.stopPropagation();
    const state = store.getState();
    if (!canEditPose(state.scene, id)) {
      state.notify("Pose locked — unlock to edit", "warning", "lock");
      return;
    }
    if (state.tool === "move" || bone === "hips" || !isPosableBone(bone)) {
      state.select({ kind: "mannequin", mannequinId: id });
    } else {
      state.select({ kind: "bone", mannequinId: id, bone });
    }
  };

  return (
    <primitive
      object={rig.root}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endMoveDrag}
      onPointerCancel={endMoveDrag}
      onPointerOut={onPointerOut}
      onClick={onClick}
    />
  );
}

export function Mannequins() {
  const ids = useEditor((s) => s.scene.mannequins.map((m) => m.id).join(","));
  return (
    <>
      {ids
        .split(",")
        .filter(Boolean)
        .map((id) => (
          <Mannequin key={id} id={id} />
        ))}
    </>
  );
}
