"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ikHandleLocal } from "@/lib/mannequin/ik";
import { bonePoint, forwardKinematics, rootTransformOf } from "@/lib/mannequin/kinematics";
import { BONE_INDEX } from "@/lib/mannequin/mesh/build";
import { posedBonePoint, restBoneCentroids } from "@/lib/mannequin/mesh/skin";
import { resolveFigureModel } from "@/lib/model-import/figure-model";
import type { Vec3 } from "@/lib/scene";
import { useEditorStore } from "../store/context";
import type { EditorState, ProjectTarget } from "../store/editor-store";
import { useInteraction } from "./interaction";

const centroidCache = new WeakMap<object, Vec3[]>();

/** World position of a projectable target (pure kinematics — independent of rendering). */
export function targetWorldPosition(state: EditorState, target: ProjectTarget): Vec3 | null {
  if (target.kind === "world") return target.position;
  if (target.kind === "gizmoRing") return null;
  if (target.kind === "light") return state.scene.lights.find((l) => l.id === target.lightId)?.position ?? null;
  const m = state.scene.mannequins.find((x) => x.id === target.mannequinId);
  if (!m) return null;
  const model = resolveFigureModel(m);
  const fk = forwardKinematics(model.layout, m.pose, rootTransformOf(m.transform));
  if (target.kind === "joint") return fk.positions[target.bone];
  if (target.kind === "ikHandle") {
    if (target.effector === "hips") return fk.positions.hips;
    const { bone, local } = ikHandleLocal(model.layout, target.effector);
    return bonePoint(fk, bone, local);
  }
  let centroids = centroidCache.get(model.geometry);
  if (!centroids) {
    centroids = restBoneCentroids(model.geometry);
    centroidCache.set(model.geometry, centroids);
  }
  return posedBonePoint(model.layout, fk, target.bone, centroids[BONE_INDEX[target.bone]]);
}

/**
 * Registers engine hooks used by the test hook and tooling: `project(target)` (page CSS pixels +
 * occlusion test) and `frameCount()`; reports readiness after the first rendered frames.
 */
export function EngineBridge() {
  const store = useEditorStore();
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getThree = useThree((s) => s.get);
  const tracker = useInteraction();
  const frames = useRef(0);

  useFrame(() => {
    frames.current += 1;
  });

  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const toPage = (ndc: THREE.Vector3) => {
      const rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
    };
    /**
     * Gizmo ring: sample its centre line and return the middle of the longest arc where this ring
     * is the first ring hit (pointer events go to the nearest ring; rings draw over the body).
     */
    const projectRing = (dof: string) => {
      const mesh = scene.getObjectByName(`gizmo-ring-${dof}`) as THREE.Mesh | undefined;
      if (!mesh || !(mesh.geometry instanceof THREE.TorusGeometry)) return null;
      const rings: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.userData.gizmoDof !== undefined) rings.push(o);
      });
      const r = mesh.geometry.parameters.radius;
      const n = 72;
      const samples: { ndc: THREE.Vector3; ok: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const ndc = mesh.localToWorld(new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), 0)).project(camera);
        let ok = Math.abs(ndc.x) < 0.97 && Math.abs(ndc.y) < 0.97 && ndc.z > -1 && ndc.z < 1;
        if (ok) {
          raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          ok = raycaster.intersectObjects(rings, false)[0]?.object === mesh;
        }
        samples.push({ ndc, ok });
      }
      let best = -1;
      let bestLen = 0;
      for (let i = 0; i < n; i++) {
        if (!samples[i].ok || samples[(i + n - 1) % n].ok) continue;
        let len = 0;
        while (len < n && samples[(i + len) % n].ok) len++;
        if (len > bestLen) {
          bestLen = len;
          best = (i + Math.floor(len / 2)) % n;
        }
      }
      if (best < 0 && samples.every((s) => s.ok)) best = 0;
      const pick = samples[Math.max(0, best)];
      return { ...toPage(pick.ndc), visible: best >= 0 };
    };
    /** The first thing the raycaster's ray meets, ignoring the floor, the grid and helpers. */
    const firstHit = () =>
      raycaster
        .intersectObjects(scene.children, true)
        .find((h) => h.object.visible && h.object.type !== "GridHelper" && h.object.name !== "floor" && !h.object.userData.artikinRole);
    /**
     * Click events report whole CSS pixels (a `pointerdown` keeps fractions, a `click` does not), and a
     * click selects whatever its ray meets first. So a bone is reported at the pixel next to its segment
     * centre whose ray meets that bone first — visible — or as not visible when no such pixel exists.
     */
    const clickableBonePixel = (target: Extract<ProjectTarget, { kind: "bone" }>, x: number, y: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      const pixels: [number, number][] = [
        [Math.round(x), Math.round(y)],
        [Math.floor(x), Math.floor(y)],
        [Math.ceil(x), Math.floor(y)],
        [Math.floor(x), Math.ceil(y)],
        [Math.ceil(x), Math.ceil(y)],
      ];
      for (const [px, py] of pixels) {
        raycaster.setFromCamera(new THREE.Vector2(((px - rect.left) / rect.width) * 2 - 1, 1 - ((py - rect.top) / rect.height) * 2), camera);
        const first = firstHit();
        const face = first?.face;
        const skin = ((first?.object as THREE.Mesh | undefined)?.geometry as THREE.BufferGeometry | undefined)?.getAttribute("skinIndex");
        const hitBone = face && skin ? skin.getX(face.a) : -1;
        if (first?.object.userData.mannequinId === target.mannequinId && hitBone === BONE_INDEX[target.bone]) return { x: px, y: py, visible: true };
      }
      return { x: Math.round(x), y: Math.round(y), visible: false };
    };
    const project = (target: ProjectTarget) => {
      if (target.kind === "gizmoRing") return projectRing(target.dof);
      const state = store.getState();
      const world = targetWorldPosition(state, target);
      if (!world) return null;
      const point = new THREE.Vector3(world[0], world[1], world[2]);
      const ndc = point.clone().project(camera);
      const { x, y } = toPage(ndc);
      let visible = ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
      if (target.kind === "bone") return visible ? clickableBonePixel(target, x, y) : { x, y, visible };
      // IK handles draw on top of everything (and win pointer events), so only the frustum matters.
      if (visible && target.kind !== "ikHandle") {
        raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
        const dist = camera.position.distanceTo(point);
        const first = firstHit();
        if (first && first.distance < dist - 0.03) {
          const sameFigure = "mannequinId" in target && first.object.userData.mannequinId === target.mannequinId;
          if (target.kind === "joint") {
            // A pivot lies inside the body: visible when the ray first meets that figure.
            visible = sameFigure;
          } else if (target.kind === "light") {
            visible = first.object.userData.lightId === target.lightId;
          } else {
            visible = false;
          }
        }
      }
      return { x, y, visible };
    };
    const renderStats = () => {
      let meshes = 0;
      scene.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) meshes += 1;
      });
      const info = gl.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        meshes,
      };
    };
    store.getState().setEngine({
      project,
      frameCount: () => frames.current,
      renderStats,
      // A reduced interaction resolution still on screen counts as a pending (full-quality) frame.
      pendingFrames: () => getThree().internal.frames + (tracker.atRestResolution ? 0 : 1),
    });
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => store.getState().setReady(true));
    });
    invalidate();
    return () => {
      cancelAnimationFrame(raf);
      store.getState().setEngine({ project: undefined, frameCount: undefined, renderStats: undefined, pendingFrames: undefined });
    };
  }, [store, camera, scene, gl, invalidate, getThree, tracker]);

  return null;
}
