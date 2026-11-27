"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import {
  DEFAULT_VIEW_DIRECTION,
  type FramingScope,
  clampPolar,
  fitView,
  framingSets,
  isFactoryCameraPlacement,
} from "../lib/framing";
import { useEditor, useEditorStore } from "../store/context";
import type { ViewPreset } from "../store/editor-store";
import { useInteraction } from "./interaction";
import { applyLens, fovFromFocalLength } from "./three-helpers";

/** drei's `OrbitControls` instance type (three-stdlib), without importing the transitive package. */
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

export { fovFromFocalLength };

type Direction = readonly [number, number, number];

const VIEW_DIRECTIONS: Readonly<Record<ViewPreset, Direction>> = {
  front: [0, 0.08, 1],
  back: [0, 0.08, -1],
  left: [1, 0.08, 0],
  right: [-1, 0.08, 0],
  top: [0, 1, 0.0001],
  threeQuarterLeft: [0.72, 0.28, 0.72],
  threeQuarterRight: [-0.72, 0.28, 0.72],
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Seconds per turntable revolution at speed 1×. */
const TURNTABLE_SECONDS = 30;
const UP = new THREE.Vector3(0, 1, 0);
const DAMPING = 0.14;
/** Orbit limits. Framing uses the same ones, so the controls never alter a framed view. */
const MIN_POLAR = 0.05;
const MIN_DISTANCE = 0.3;
const MAX_DISTANCE = 30;
/** Framing never brings the camera closer than this to its target (m). */
const FRAME_MIN_DISTANCE = 0.35;

type StoredCamera = { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] };
interface HeldCamera {
  source: StoredCamera;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * View lock: keep the camera exactly at the stored angle. The held pose is the stored camera after one
 * OrbitControls update (which applies the distance/polar limits), so holding it is a fixed point.
 * Returns true when the camera was moved.
 */
function holdCamera(camera: THREE.Camera, controls: OrbitControlsImpl, stored: StoredCamera, held: { current: HeldCamera | null }): boolean {
  const h = held.current;
  if (!h || h.source !== stored) {
    camera.position.set(...stored.position);
    controls.target.set(...stored.target);
    controls.update();
    held.current = { source: stored, position: camera.position.clone(), target: controls.target.clone() };
    return true;
  }
  if (camera.position.distanceToSquared(h.position) < 1e-12 && controls.target.distanceToSquared(h.target) < 1e-12) return false;
  camera.position.copy(h.position);
  controls.target.copy(h.target);
  controls.update();
  return true;
}

/**
 * Stop at the angle on screen: with dampingFactor 1 (view locked) one update consumes the damping tail
 * of an orbit that is still coasting; then the camera goes back to where it was.
 */
function settleControls(camera: THREE.Camera, controls: OrbitControlsImpl) {
  const position = camera.position.clone();
  const target = controls.target.clone();
  controls.update();
  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();
}

/** A camera position and target as the store keeps them (rounded to the millimetre). */
interface SavedView {
  position: [number, number, number];
  target: [number, number, number];
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

function savedView(camera: THREE.Camera, controls: OrbitControlsImpl): SavedView {
  return {
    position: [mm(camera.position.x), mm(camera.position.y), mm(camera.position.z)],
    target: [mm(controls.target.x), mm(controls.target.y), mm(controls.target.z)],
  };
}

function sameView(a: SavedView, b: SavedView): boolean {
  return a.position.every((v, i) => v === b.position[i]) && a.target.every((v, i) => v === b.target[i]);
}

/**
 * Width of the controls covering the canvas' top-right corner (the camera views cluster, marked
 * `data-viewport-overlay="top-right"`), measured from the canvas' right edge; 0 when there are none.
 */
function topRightOverlayWidth(canvas: HTMLCanvasElement): number {
  const overlay = canvas.ownerDocument.querySelector<HTMLElement>('[data-viewport-overlay="top-right"]');
  if (!overlay) return 0;
  const area = canvas.getBoundingClientRect();
  const box = overlay.getBoundingClientRect();
  if (box.width === 0 || box.left >= area.right || box.right <= area.left) return 0;
  return area.right - box.left;
}

export function CameraRig() {
  const store = useEditorStore();
  const tracker = useInteraction();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const getThree = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const focalLength = useEditor((s) => s.camera.focalLength);
  const turntable = useEditor((s) => s.turntable);
  const command = useEditor((s) => s.cameraCommand);
  const viewLocked = useEditor((s) => s.scene.lock.view);
  const animation = useRef<{ from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; start: number; ms: number } | null>(null);
  const turntableMoved = useRef(false);
  const held = useRef<HeldCamera | null>(null);
  /**
   * Auto framing (ARCHITECTURE §9.6): while the scene's camera was never moved, the rig frames the
   * scene for this canvas and lens. `autoView` is the view it placed (null once the camera was moved
   * by the user); `autoFor` the canvas size and field of view it was made for.
   */
  const autoView = useRef<SavedView | null>(null);
  const autoFor = useRef("");
  /** True while the rig moves the camera itself (OrbitControls reports those changes too). */
  const programmatic = useRef(false);

  /** Moves the camera at once (no animation). */
  const place = (position: THREE.Vector3, target: THREE.Vector3) => {
    const c = controlsRef.current;
    if (!c) return;
    programmatic.current = true;
    camera.position.copy(position);
    c.target.copy(target);
    c.update();
    programmatic.current = false;
    invalidate();
  };

  /** The framing of `scope` seen along `direction` (target → camera), for the current lens and canvas. */
  const frame = (scope: FramingScope, direction: Direction) => {
    const { size: canvas, gl } = getThree();
    if (!(canvas.width > 0 && canvas.height > 0)) return null;
    const fit = fitView({
      sets: framingSets(store.getState(), scope, {
        width: canvas.width,
        height: canvas.height,
        overlayRight: topRightOverlayWidth(gl.domElement),
      }),
      direction: clampPolar(direction, MIN_POLAR),
      fovDeg: camera.fov,
      aspect: canvas.width / canvas.height,
      minDistance: FRAME_MIN_DISTANCE,
      maxDistance: MAX_DISTANCE,
    });
    return fit && { position: new THREE.Vector3(...fit.position), target: new THREE.Vector3(...fit.target) };
  };

  /** The scene frames itself while its camera was never moved and the view is not locked. */
  const autoFraming = () => {
    const s = store.getState();
    return isFactoryCameraPlacement(s.camera) && !s.scene.lock.view;
  };

  /** Auto framing: every visible figure head-to-toe with its floor contact, and every visible bulb. */
  const autoFrame = (): boolean => {
    const c = controlsRef.current;
    const fit = frame("default", DEFAULT_VIEW_DIRECTION);
    if (!c || !fit) return false;
    animation.current = null;
    place(fit.position, fit.target);
    autoView.current = savedView(camera, c);
    const { size: canvas } = getThree();
    autoFor.current = `${canvas.width}×${canvas.height}@${camera.fov}`;
    return true;
  };

  /**
   * Writes the camera to the store. While the camera still shows the auto framing (e.g. after a click
   * that did not move it), the document keeps the factory placement, so the scene goes on framing
   * itself for other canvas sizes, reloads and devices. `force` (view lock) saves the angle on screen.
   */
  const saveCamera = (force = false) => {
    const c = controlsRef.current;
    if (!c) return;
    const view = savedView(camera, c);
    if (!force && autoView.current && sameView(view, autoView.current)) return;
    autoView.current = null;
    store.getState().setCamera(view);
  };

  // Initial camera: auto framing, or the document's camera.
  useLayoutEffect(() => {
    if (autoFraming() && autoFrame()) return;
    const c = store.getState().camera;
    camera.position.set(...c.position);
    controlsRef.current?.target.set(...c.target);
    camera.lookAt(...c.target);
    controlsRef.current?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, camera, invalidate]);

  useLayoutEffect(() => {
    applyLens(camera, focalLength);
    invalidate();
  }, [camera, focalLength, invalidate]);

  // Auto framing follows the canvas size and the lens (after the lens effect above) until the camera
  // is moved.
  useLayoutEffect(() => {
    if (!autoView.current || !autoFraming()) return;
    const s = store.getState();
    if (s.gestureActive || s.turntable.enabled || animation.current) return;
    if (autoFor.current === `${size.width}×${size.height}@${camera.fov}`) return;
    autoFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, focalLength]);

  useLayoutEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    // The turntable is driven in useFrame (exact stop); OrbitControls' autoRotate would keep
    // coasting through its damping after being switched off.
    c.autoRotate = false;
    invalidate();
  }, [turntable, invalidate]);

  const animateTo = (position: THREE.Vector3, target: THREE.Vector3) => {
    const c = controlsRef.current;
    if (!c) return;
    if (prefersReducedMotion()) {
      place(position, target);
      saveCamera();
      return;
    }
    animation.current = {
      from: camera.position.clone(),
      to: position,
      fromT: c.target.clone(),
      toT: target,
      start: performance.now(),
      ms: 420,
    };
    invalidate();
  };

  // Camera commands from the UI / shortcuts. A layout effect, declared before the view-lock effect: a
  // loaded document's camera is applied before the lock captures the angle on screen.
  useLayoutEffect(() => {
    if (!command) return;
    const c = controlsRef.current;
    if (!c) return;
    // The store refuses moves while the view is locked; only a loaded document's camera gets through.
    if (store.getState().scene.lock.view && command.kind !== "set") return;
    if (command.kind === "set") {
      // A loaded scene whose camera was never moved frames itself.
      if (isFactoryCameraPlacement(command) && autoFraming() && autoFrame()) return;
      autoView.current = null;
      const position = new THREE.Vector3(...command.position);
      const target = new THREE.Vector3(...command.target);
      if (command.animate) animateTo(position, target);
      else {
        animation.current = null;
        place(position, target);
      }
    } else if (command.kind === "view") {
      // View presets show every visible figure head-to-toe, with its floor contact, from their side.
      const direction = VIEW_DIRECTIONS[command.view];
      const fit = frame("figures", direction);
      if (fit) animateTo(fit.position, fit.target);
      else {
        const dir = new THREE.Vector3(...clampPolar(direction, MIN_POLAR));
        animateTo(c.target.clone().add(dir.multiplyScalar(camera.position.distanceTo(c.target))), c.target.clone());
      }
    } else {
      // Frame selection: the selected joint, figure or bulb (every visible figure when none).
      const d = camera.position.clone().sub(c.target);
      const fit = frame("selection", [d.x, d.y, d.z]);
      if (fit) animateTo(fit.position, fit.target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  // View lock (PROJECT F6): orbit/zoom/pan input is off (props below); the angle on screen when locking
  // becomes the locked camera, saved with the scene so that it survives reloads.
  useLayoutEffect(() => {
    held.current = null;
    const c = controlsRef.current;
    if (!c || !viewLocked) return;
    animation.current = null;
    turntableMoved.current = false;
    settleControls(camera, c);
    saveCamera(true);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLocked]);

  useFrame((_, delta) => {
    const a = animation.current;
    const c = controlsRef.current;
    if (c && viewLocked) {
      if (holdCamera(camera, c, store.getState().camera, held)) invalidate();
      return;
    }
    if (a && c) {
      const t = Math.min(1, (performance.now() - a.start) / a.ms);
      const k = t * t * (3 - 2 * t);
      // Interpolate on a sphere around the target for a smooth orbit-like move.
      const target = a.fromT.clone().lerp(a.toT, k);
      const fromOff = a.from.clone().sub(a.fromT);
      const toOff = a.to.clone().sub(a.toT);
      const len = THREE.MathUtils.lerp(fromOff.length(), toOff.length(), k);
      const dir = fromOff.normalize().lerp(toOff.normalize(), k);
      if (dir.lengthSq() < 1e-8) dir.copy(toOff);
      camera.position.copy(target).add(dir.normalize().multiplyScalar(len));
      c.target.copy(target);
      c.update();
      if (t >= 1) {
        animation.current = null;
        saveCamera();
      }
      invalidate();
    } else if (turntable.enabled && c) {
      // One turn per TURNTABLE_SECONDS at speed 1 (clamped step: no jump after a stalled frame).
      const angle = ((Math.PI * 2) / TURNTABLE_SECONDS) * turntable.speed * Math.min(delta, 0.1);
      const offset = camera.position.clone().sub(c.target).applyAxisAngle(UP, angle);
      camera.position.copy(c.target).add(offset);
      c.update();
      turntableMoved.current = true;
      invalidate();
    } else if (turntableMoved.current) {
      turntableMoved.current = false;
      saveCamera();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      // View lock: no rotate/zoom/pan input (wheel and touch included). Kept separate from `enabled`,
      // which gizmo/handle drags toggle; dampingFactor 1 leaves no damping tail to coast on.
      enableRotate={!viewLocked}
      enableZoom={!viewLocked}
      enablePan={!viewLocked}
      dampingFactor={viewLocked ? 1 : DAMPING}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={Math.PI - MIN_POLAR}
      zoomSpeed={0.9}
      rotateSpeed={0.75}
      // Orbit/pan holds the pointer (no hover picking); any camera motion lowers the resolution
      // until the view settles (damping tail, wheel zoom, view animations, turntable).
      onStart={() => tracker.begin("orbit")}
      onChange={() => {
        tracker.poke();
        // A camera move the rig did not make itself (drag, wheel, touch, damping tail, animation,
        // turntable) ends auto framing.
        if (!programmatic.current) autoView.current = null;
      }}
      onEnd={() => {
        tracker.end("orbit");
        saveCamera();
      }}
    />
  );
}
