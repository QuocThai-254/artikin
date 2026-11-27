"use client";

import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useRef, useState } from "react";
import * as THREE from "three";
import { resolveFigureModel } from "@/lib/model-import/figure-model";
import { useEditor, useEditorStore } from "../store/context";
import { canEditPose } from "../store/guards";
import { setControlsEnabled, setCursor } from "./three-helpers";

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

interface TurnDrag {
  pointerId: number;
  center: THREE.Vector3;
  startAngle: number;
  startYaw: number;
}

/**
 * Move tool (PROJECT F3): drag the figure's body across the floor (handled by the mannequin's
 * pointer events) and turn it with this ring lying on the floor around its feet.
 */
export function MoveGizmo() {
  const id = useEditor((s) => {
    if (s.tool !== "move") return null;
    const sel = s.selection;
    if (sel.kind !== "mannequin" && sel.kind !== "bone") return null;
    return canEditPose(s.scene, sel.mannequinId) ? sel.mannequinId : null;
  });
  if (!id) return null;
  return <TurnRing key={id} mannequinId={id} />;
}

function TurnRing({ mannequinId }: { mannequinId: string }) {
  const store = useEditorStore();
  const controls = useThree((s) => s.controls);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<THREE.Group>(null);
  const drag = useRef<TurnDrag | null>(null);
  const [hot, setHot] = useState(false);

  const radius = useEditor((s) => {
    const m = s.scene.mannequins.find((x) => x.id === mannequinId);
    return m ? resolveFigureModel(m).proportions.height * 0.3 : 0.5;
  });

  useFrame(() => {
    const m = store.getState().scene.mannequins.find((x) => x.id === mannequinId);
    const g = group.current;
    if (!m || !g) return;
    g.position.set(m.transform.position[0], 0.012, m.transform.position[2]);
  });

  const angleOf = (e: ThreeEvent<PointerEvent>, center: THREE.Vector3) => {
    const hit = e.ray.intersectPlane(FLOOR, new THREE.Vector3());
    if (!hit) return null;
    return Math.atan2(hit.x - center.x, hit.z - center.z);
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = store.getState();
    const m = state.scene.mannequins.find((x) => x.id === mannequinId);
    if (!m || !canEditPose(state.scene, mannequinId)) return;
    const center = new THREE.Vector3(m.transform.position[0], 0, m.transform.position[2]);
    const a = angleOf(e, center);
    if (a === null) return;
    drag.current = { pointerId: e.pointerId, center, startAngle: a, startYaw: m.transform.rotation[1] };
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    setControlsEnabled(controls, false);
    state.beginGesture();
    setCursor(gl.domElement, "grabbing");
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const a = angleOf(e, d.center);
    if (a === null) return;
    const state = store.getState();
    const m = state.scene.mannequins.find((x) => x.id === mannequinId);
    if (!m) return;
    let yaw = d.startYaw + ((a - d.startAngle) * 180) / Math.PI;
    if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey) yaw = Math.round(yaw / 15) * 15;
    state.setMannequinTransform(mannequinId, { rotation: [m.transform.rotation[0], yaw, m.transform.rotation[2]] });
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    (e.target as unknown as Element).releasePointerCapture?.(d.pointerId);
    drag.current = null;
    setControlsEnabled(controls, true);
    store.getState().endGesture();
    setCursor(gl.domElement, "");
    invalidate();
  };

  return (
    <group ref={group} userData={{ artikinRole: "helper" }}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={1000} raycast={() => null} userData={{ artikinRole: "helper" }}>
        <ringGeometry args={[radius * 0.94, radius * (hot ? 1.1 : 1.05), 96]} />
        <meshBasicMaterial color="#ffb02e" transparent opacity={hot ? 0.95 : 0.75} depthTest={false} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        name="move-turn-ring"
        rotation-x={-Math.PI / 2}
        userData={{ artikinRole: "helper", overlay: true }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHot(true);
          setCursor(gl.domElement, "grab");
          invalidate();
        }}
        onPointerOut={() => {
          if (drag.current) return;
          setHot(false);
          setCursor(gl.domElement, "");
          invalidate();
        }}
      >
        <ringGeometry args={[radius * 0.82, radius * 1.22, 64]} />
        <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} colorWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
