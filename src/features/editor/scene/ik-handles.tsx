"use client";

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { type IkHandleId, headLookChain, ikChainFor, ikHandleLocal, solveIk } from "@/lib/mannequin/ik";
import { bonePoint, forwardKinematics, rootTransformOf } from "@/lib/mannequin/kinematics";
import type { Quat, Vec3 } from "@/lib/mannequin/quat";
import { resolveFigureModel } from "@/lib/model-import/figure-model";
import { useEditor, useEditorStore } from "../store/context";
import type { EditorState } from "../store/editor-store";
import { canEditPose } from "../store/guards";
import { useRigRegistry } from "./rig-registry";
import { setControlsEnabled, setCursor } from "./three-helpers";

type Effector = IkHandleId | "hips";
const EFFECTORS: readonly Effector[] = ["leftHand", "rightHand", "leftFoot", "rightFoot", "head", "hips"];
const HANDLE_PX = 9;
const HANDLE_COLOR: Record<Effector, string> = {
  leftHand: "#ffb347",
  rightHand: "#ffb347",
  leftFoot: "#4fd1c5",
  rightFoot: "#4fd1c5",
  head: "#b794f4",
  hips: "#f7fafc",
};

interface IkDrag {
  effector: Effector;
  pointerId: number;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  /** Feet: world orientation to keep. Hips: planted feet targets & orientations. */
  footWorld?: Quat;
  planted?: { left: { target: Vec3; world: Quat }; right: { target: Vec3; world: Quat } };
  startHips?: Vec3;
  startHandle?: Vec3;
  pending: Vec3 | null;
  last: Vec3 | null;
}

/** World position of an IK handle (same definition as the test hook's `project`). */
function handleWorld(state: EditorState, mannequinId: string, effector: Effector): Vec3 | null {
  const m = state.scene.mannequins.find((x) => x.id === mannequinId);
  if (!m) return null;
  const model = resolveFigureModel(m);
  const fk = forwardKinematics(model.layout, m.pose, rootTransformOf(m.transform));
  if (effector === "hips") return fk.positions.hips;
  const { bone, local } = ikHandleLocal(model.layout, effector);
  return bonePoint(fk, bone, local);
}

const same = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/** Apply one IK solve for the dragged handle (called at most once per frame). */
function solveDrag(state: EditorState, mannequinId: string, d: IkDrag, target: Vec3) {
  const m = state.scene.mannequins.find((x) => x.id === mannequinId);
  if (!m) return;
  const model = resolveFigureModel(m);
  const layout = model.layout;
  if (d.effector === "hips") {
    if (!d.startHips || !d.startHandle || !d.planted) return;
    const position: Vec3 = [
      d.startHips[0] + target[0] - d.startHandle[0],
      d.startHips[1] + target[1] - d.startHandle[1],
      d.startHips[2] + target[2] - d.startHandle[2],
    ];
    const root = rootTransformOf({ position, rotation: m.transform.rotation });
    let pose = m.pose;
    for (const side of ["left", "right"] as const) {
      const foot = side === "left" ? "leftFoot" : "rightFoot";
      const planted = d.planted[side];
      pose = solveIk(layout, pose, root, ikChainFor(layout, foot), planted.target, {
        iterations: 24,
        keepOrientation: { bone: foot, world: planted.world },
      }).pose;
    }
    state.setMannequinTransform(mannequinId, { position });
    state.setPose(mannequinId, pose);
    return;
  }
  const root = rootTransformOf(m.transform);
  const chain =
    d.effector === "head" ? headLookChain(layout, forwardKinematics(layout, m.pose, root), target) : ikChainFor(layout, d.effector);
  const res = solveIk(layout, m.pose, root, chain, target, {
    iterations: 20,
    keepOrientation: d.footWorld && (d.effector === "leftFoot" || d.effector === "rightFoot") ? { bone: d.effector, world: d.footWorld } : undefined,
  });
  state.setPose(mannequinId, res.pose);
}

/**
 * IK handles (Drag tool, PROJECT F3): hands, feet, head (look target) and hips (move the body
 * with the feet planted). Drag in the camera-facing plane through the handle; the solver runs at
 * most once per frame, the result is clamped by the store, one drag = one undo step.
 */
export function IkHandles() {
  const ids = useEditor((s) =>
    s.tool === "drag"
      ? s.scene.mannequins
          .filter((m) => m.visible && canEditPose(s.scene, m.id))
          .map((m) => m.id)
          .join(",")
      : "",
  );
  if (!ids) return null;
  return (
    <>
      {ids.split(",").map((id) => (
        <FigureHandles key={id} mannequinId={id} />
      ))}
    </>
  );
}

function FigureHandles({ mannequinId }: { mannequinId: string }) {
  const store = useEditorStore();
  const registry = useRigRegistry();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const refs = useRef<Partial<Record<Effector, THREE.Group>>>({});
  const drag = useRef<IkDrag | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const state = store.getState();
    const d = drag.current;
    if (d?.pending && (!d.last || !same(d.pending, d.last))) {
      solveDrag(state, mannequinId, d, d.pending);
      d.last = d.pending;
      d.pending = null;
    }
    const fov = camera instanceof THREE.PerspectiveCamera ? (camera.fov * Math.PI) / 180 : 0.5;
    for (const eff of EFFECTORS) {
      const g = refs.current[eff];
      const p = handleWorld(store.getState(), mannequinId, eff);
      if (!g || !p) continue;
      g.position.set(p[0], p[1], p[2]);
      const dist = camera.position.distanceTo(g.position);
      g.scale.setScalar((HANDLE_PX * 2 * dist * Math.tan(fov / 2)) / Math.max(1, size.height));
    }
    if (!registry.get(mannequinId)) invalidate();
  });

  const onDown = (eff: Effector) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = store.getState();
    if (!canEditPose(state.scene, mannequinId)) return;
    const m = state.scene.mannequins.find((x) => x.id === mannequinId);
    const start = handleWorld(state, mannequinId, eff);
    if (!m || !start) return;
    const p = new THREE.Vector3(...start);
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    const model = resolveFigureModel(m);
    const fk = forwardKinematics(model.layout, m.pose, rootTransformOf(m.transform));
    const d: IkDrag = { effector: eff, pointerId: e.pointerId, plane, offset: p.clone().sub(hit), pending: null, last: null };
    if (eff === "leftFoot" || eff === "rightFoot") d.footWorld = fk.orientations[eff];
    if (eff === "hips") {
      const footTarget = (foot: "leftFoot" | "rightFoot") => {
        const { bone, local } = ikHandleLocal(model.layout, foot);
        return { target: bonePoint(fk, bone, local), world: fk.orientations[foot] };
      };
      d.planted = { left: footTarget("leftFoot"), right: footTarget("rightFoot") };
      d.startHips = [...m.transform.position];
      d.startHandle = start;
    }
    drag.current = d;
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    setControlsEnabled(controls, false);
    state.beginGesture();
    setCursor(gl.domElement, "grabbing");
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const hit = e.ray.intersectPlane(d.plane, tmp);
    if (!hit) return;
    hit.add(d.offset);
    d.pending = [hit.x, hit.y, hit.z];
    invalidate();
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    if (d.pending && (!d.last || !same(d.pending, d.last))) solveDrag(store.getState(), mannequinId, d, d.pending);
    (e.target as unknown as Element).releasePointerCapture?.(d.pointerId);
    drag.current = null;
    setControlsEnabled(controls, true);
    store.getState().endGesture();
    setCursor(gl.domElement, "");
    invalidate();
  };

  return (
    <group userData={{ artikinRole: "helper" }}>
      {EFFECTORS.map((eff) => (
        <group
          key={eff}
          ref={(g) => {
            refs.current[eff] = g ?? undefined;
          }}
        >
          <mesh
            name={`ik-handle-${eff}`}
            renderOrder={1002}
            userData={{ artikinRole: "helper", ikHandle: eff, overlay: true }}
            onPointerDown={onDown(eff)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerOver={(e) => {
              e.stopPropagation();
              setCursor(gl.domElement, "grab");
            }}
            onPointerOut={() => {
              if (!drag.current) setCursor(gl.domElement, "");
            }}
          >
            <sphereGeometry args={[1, 20, 14]} />
            <meshBasicMaterial color={HANDLE_COLOR[eff]} transparent opacity={0.9} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh renderOrder={1001} raycast={() => null} userData={{ artikinRole: "helper" }}>
            <ringGeometry args={[1.25, 1.6, 32]} />
            <meshBasicMaterial color="#111318" transparent opacity={0.55} depthTest={false} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
