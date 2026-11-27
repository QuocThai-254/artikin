"use client";

import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PosableBoneName } from "@/lib/mannequin/bones";
import { DOF_INDEX, type Dof, clampDof, dofMotion, getBoneRom } from "@/lib/mannequin/rom";
import { DOF_COLORS } from "../lib/dof-colors";
import { useEditor, useEditorStore } from "../store/context";
import { canEditPose } from "../store/guards";
import { useRigRegistry } from "./rig-registry";
import { setControlsEnabled, setCursor, setText } from "./three-helpers";

/** Ring radius in screen pixels (constant on screen) and per-DOF radius factors. */
const RING_PX = 74;
const RING_FACTOR: Record<Dof, number> = { flex: 1, side: 0.86, twist: 0.72 };
const ARC_SEGMENTS = 64;

const Z = new THREE.Vector3(0, 0, 1);

interface DragState {
  dof: Dof;
  pointerId: number;
  startValue: number;
  radPerDeg: number;
  mode: "dial" | "tangent";
  /** dial: last pointer angle (screen), accumulated angle and rotation sign. */
  lastAngle: number;
  total: number;
  sign: number;
  /** tangent: start pointer (px), unit screen tangent, ring radius (px). */
  start: THREE.Vector2;
  tangent: THREE.Vector2;
  radiusPx: number;
}

/**
 * FK rotate gizmo (PROJECT F3): one colored ring per unlocked DOF of the selected joint (knee:
 * one ring). A ring's normal is the DOF's current motion axis (`rom.dofMotion`), so dragging it
 * changes exactly that semantic value, clamped to the ROM — the motion stops smoothly at the limit.
 * Hovering / dragging a ring shows its allowed range as a translucent wedge.
 */
export function BoneGizmo() {
  const key = useEditor((s) =>
    s.tool === "rotate" && s.selection.kind === "bone" && canEditPose(s.scene, s.selection.mannequinId)
      ? `${s.selection.mannequinId}|${s.selection.bone}`
      : null,
  );
  if (!key) return null;
  const [mannequinId, bone] = key.split("|");
  return <BoneRings key={key} mannequinId={mannequinId} bone={bone as PosableBoneName} />;
}

function pointerPx(e: ThreeEvent<PointerEvent>, size: { width: number; height: number }) {
  return new THREE.Vector2(((e.pointer.x + 1) / 2) * size.width, ((1 - e.pointer.y) / 2) * size.height);
}

function BoneRings({ mannequinId, bone }: { mannequinId: string; bone: PosableBoneName }) {
  const store = useEditorStore();
  const registry = useRigRegistry();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const rom = getBoneRom(bone);

  const group = useRef<THREE.Group>(null);
  const rings = useRef<Partial<Record<Dof, THREE.Group>>>({});
  const arc = useRef<THREE.Mesh>(null);
  const drag = useRef<DragState | null>(null);
  const labelText = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Dof | null>(null);
  const [active, setActive] = useState<Dof | null>(null);
  // The angle label mounts once per drag; its text changes imperatively (no React commit per move).
  const [label, setLabel] = useState<string | null>(null);

  const arcGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((ARC_SEGMENTS + 2) * 3), 3));
    const idx: number[] = [];
    for (let i = 1; i <= ARC_SEGMENTS; i++) idx.push(0, i, i + 1);
    g.setIndex(idx);
    return g;
  }, []);
  useEffect(() => () => arcGeometry.dispose(), [arcGeometry]);

  // Scratch objects (mutated only inside frame / event callbacks).
  const tmp = useMemo(
    () => ({
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      ref: new THREE.Vector3(),
      v: new THREE.Vector3(),
      bq: new THREE.Quaternion(),
    }),
    [],
  );

  const angles = () => store.getState().scene.mannequins.find((m) => m.id === mannequinId)?.pose[bone] ?? [0, 0, 0];
  const angleLabel = (dof: Dof, degrees: number) => `${rom.labels[dof]?.title ?? dof}: ${Math.round(degrees)}°`;

  /** Joint world position + parent orientation (into `tmp`) and the pixel → world scale. */
  const frame = () => {
    const rig = registry.get(mannequinId);
    if (!rig) return null;
    const b = rig.bones[bone];
    const parent = b.parent ?? b;
    b.getWorldPosition(tmp.p);
    parent.getWorldQuaternion(tmp.q);
    const dist = camera.position.distanceTo(tmp.p);
    const fov = camera instanceof THREE.PerspectiveCamera ? (camera.fov * Math.PI) / 180 : 0.5;
    const worldPerPx = (2 * dist * Math.tan(fov / 2)) / Math.max(1, size.height);
    return { b, worldPerPx };
  };

  useFrame(() => {
    const f = frame();
    const g = group.current;
    if (!f || !g) return;
    g.position.copy(tmp.p);
    g.scale.setScalar(RING_PX * f.worldPerPx);
    const a = angles();
    for (const dof of rom.dofs) {
      const ring = rings.current[dof];
      const m = dofMotion(bone, dof, a);
      if (!ring || !m) continue;
      tmp.axis.set(m.axis[0], m.axis[1], m.axis[2]).applyQuaternion(tmp.q).normalize();
      ring.quaternion.setFromUnitVectors(Z, tmp.axis);
    }
    // Allowed-range wedge for the hovered / active ring.
    const show = active ?? hovered;
    const mesh = arc.current;
    if (mesh) mesh.visible = !!show;
    if (!show || !mesh) return;
    const m = dofMotion(bone, show, a);
    if (!m) return;
    tmp.axis.set(m.axis[0], m.axis[1], m.axis[2]).applyQuaternion(tmp.q).normalize();
    // Reference: the bone's own direction projected on the ring plane (twist: its front axis).
    f.b.getWorldQuaternion(tmp.bq);
    if (bone === "spine" || bone === "chest" || bone === "neck" || bone === "head") tmp.ref.set(0, 1, 0);
    else if (bone.endsWith("Foot") || bone.endsWith("Toes")) tmp.ref.set(0, 0, 1);
    else tmp.ref.set(0, -1, 0);
    tmp.ref.applyQuaternion(tmp.bq);
    tmp.ref.addScaledVector(tmp.axis, -tmp.ref.dot(tmp.axis));
    if (tmp.ref.lengthSq() < 1e-4) {
      tmp.ref.set(0, 0, 1).applyQuaternion(tmp.bq);
      tmp.ref.addScaledVector(tmp.axis, -tmp.ref.dot(tmp.axis));
    }
    tmp.ref.normalize();
    const k = DOF_INDEX[show];
    const [min, max] = rom.limits[k];
    const a0 = (min - a[k]) * m.radPerDeg;
    const a1 = (max - a[k]) * m.radPerDeg;
    const pos = arcGeometry.getAttribute("position") as THREE.BufferAttribute;
    const r = RING_FACTOR[show] * 0.97;
    pos.setXYZ(0, 0, 0, 0);
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = a0 + ((a1 - a0) * i) / ARC_SEGMENTS;
      tmp.v.copy(tmp.ref).applyAxisAngle(tmp.axis, t).multiplyScalar(r);
      pos.setXYZ(i + 1, tmp.v.x, tmp.v.y, tmp.v.z);
    }
    pos.needsUpdate = true;
    arcGeometry.computeBoundingSphere();
    (mesh.material as THREE.MeshBasicMaterial).color.set(DOF_COLORS[show]);
  });

  const onDown = (dof: Dof) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = store.getState();
    if (!canEditPose(state.scene, mannequinId)) return;
    const f = frame();
    const a = angles();
    const m = dofMotion(bone, dof, a);
    if (!f || !m) return;
    const axis = new THREE.Vector3(m.axis[0], m.axis[1], m.axis[2]).applyQuaternion(tmp.q).normalize();
    const joint = tmp.p.clone();
    const toCamera = camera.position.clone().sub(joint).normalize();
    const facing = axis.dot(toCamera);
    const center = joint.clone().project(camera);
    const cpx = new THREE.Vector2(((center.x + 1) / 2) * size.width, ((1 - center.y) / 2) * size.height);
    const px = pointerPx(e, size);
    // Screen tangent at the grab point (used when the ring is seen edge-on).
    const grab = e.point.clone().sub(joint);
    const tangent3 = new THREE.Vector3().crossVectors(axis, grab).normalize();
    const g0 = e.point.clone().project(camera);
    const g1 = e.point.clone().addScaledVector(tangent3, f.worldPerPx * 10).project(camera);
    const tangent = new THREE.Vector2((g1.x - g0.x) * size.width, -(g1.y - g0.y) * size.height).normalize();
    drag.current = {
      dof,
      pointerId: e.pointerId,
      startValue: a[DOF_INDEX[dof]],
      radPerDeg: m.radPerDeg,
      mode: Math.abs(facing) > 0.3 ? "dial" : "tangent",
      lastAngle: Math.atan2(px.y - cpx.y, px.x - cpx.x),
      total: 0,
      sign: facing > 0 ? -1 : 1,
      start: px,
      tangent,
      radiusPx: RING_PX * RING_FACTOR[dof],
    };
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    setControlsEnabled(controls, false);
    state.beginGesture();
    setActive(dof);
    setLabel(angleLabel(dof, a[DOF_INDEX[dof]]));
    setCursor(gl.domElement, "grabbing");
    invalidate();
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const px = pointerPx(e, size);
    let angle: number;
    if (d.mode === "dial") {
      const center = tmp.p.clone().project(camera);
      const cx = ((center.x + 1) / 2) * size.width;
      const cy = ((1 - center.y) / 2) * size.height;
      const now = Math.atan2(px.y - cy, px.x - cx);
      let delta = now - d.lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      d.lastAngle = now;
      d.total += delta;
      angle = d.sign * d.total;
    } else {
      angle = px.clone().sub(d.start).dot(d.tangent) / d.radiusPx;
    }
    const native = e.nativeEvent;
    const fine = native.shiftKey ? 0.25 : 1;
    let value = d.startValue + (angle * fine) / d.radPerDeg;
    if (native.ctrlKey || native.metaKey) value = Math.round(value / 5) * 5;
    const clamped = clampDof(bone, d.dof, value);
    store.getState().setBoneDof(mannequinId, bone, d.dof, Math.round(clamped * 10) / 10);
    setText(labelText.current, angleLabel(d.dof, clamped));
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    (e.target as unknown as Element).releasePointerCapture?.(d.pointerId);
    drag.current = null;
    setActive(null);
    setLabel(null);
    setControlsEnabled(controls, true);
    store.getState().endGesture();
    setCursor(gl.domElement, "");
    invalidate();
  };

  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        setControlsEnabled(controls, true);
        store.getState().endGesture();
      }
    },
    [controls, store],
  );

  return (
    <group ref={group} userData={{ artikinRole: "helper" }}>
      {rom.dofs.map((dof) => {
        const emphasized = active === dof || (!active && hovered === dof);
        const r = RING_FACTOR[dof];
        return (
          <group
            key={dof}
            ref={(g) => {
              rings.current[dof] = g ?? undefined;
            }}
          >
            <mesh renderOrder={1001} userData={{ artikinRole: "helper" }} raycast={() => null}>
              <torusGeometry args={[r, emphasized ? 0.034 : 0.022, 8, 96]} />
              <meshBasicMaterial
                color={DOF_COLORS[dof]}
                depthTest={false}
                depthWrite={false}
                transparent
                opacity={active && active !== dof ? 0.25 : emphasized ? 1 : 0.85}
                toneMapped={false}
              />
            </mesh>
            <mesh
              name={`gizmo-ring-${dof}`}
              userData={{ artikinRole: "helper", gizmoDof: dof, overlay: true }}
              onPointerOver={(e) => {
                e.stopPropagation();
                if (!drag.current) {
                  setHovered(dof);
                  setCursor(gl.domElement, "grab");
                  invalidate();
                }
              }}
              onPointerOut={() => {
                if (!drag.current) {
                  setHovered((h) => (h === dof ? null : h));
                  setCursor(gl.domElement, "");
                  invalidate();
                }
              }}
              onPointerDown={onDown(dof)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <torusGeometry args={[r, 0.11, 6, 64]} />
              <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} colorWrite={false} />
            </mesh>
          </group>
        );
      })}
      <mesh ref={arc} geometry={arcGeometry} renderOrder={999} userData={{ artikinRole: "helper" }} raycast={() => null} visible={false}>
        <meshBasicMaterial transparent opacity={0.2} depthTest={false} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {label && (
        <Html center position={[0, 1.3, 0]} style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
          <div ref={labelText} className="rounded bg-black/75 px-2 py-0.5 font-mono text-xs whitespace-nowrap text-white">
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
