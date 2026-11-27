/**
 * Editor store — zustand + zundo (ARCHITECTURE §10).
 *
 * - `scene` (the scene document without the camera) is undoable; `camera`, selection, hover, tool
 *   and UI state are not. One drag gesture = one history step (beginGesture / endGesture).
 * - Every mutating action goes through the ROM clamp and the central lock guards (guards.ts):
 *   the store is the last line of defense, whatever the input path.
 * - Persistence is pluggable (S4): the initial document comes in, document changes go out through
 *   `subscribeToDocument`, and `persistence` carries the save status.
 */

import { temporal } from "zundo";
import { type StoreApi, createStore } from "zustand/vanilla";

import { MAX_LIGHTS_PER_SCENE, MAX_MANNEQUINS_PER_SCENE, FIGURE_NAME_MAX_LENGTH } from "@/lib/config";
import { type HumanBoneName, type PosableBoneName } from "@/lib/mannequin/bones";
import { groundedHipsHeight } from "@/lib/mannequin/figure-model";
import {
  type Pose,
  type Side,
  applyHandPresetToPose,
  applyPosePresetToPose,
  clampPose,
  getAngles,
  mirrorPose,
  resetBones,
  setBoneAngles,
  swapSides,
} from "@/lib/mannequin/pose-math";
import { MATERIAL_DEFAULT_COLORS, getBodyPreset } from "@/lib/mannequin/presets/body";
import {
  type FigurePresetData,
  parseFigurePresetData,
  posePresetOfFigurePreset,
  proportionOverridesOf,
} from "@/lib/mannequin/presets/figure-preset";
import { DEFAULT_POSE_PRESET } from "@/lib/mannequin/presets/pose";
import type { HandPreset, PosePreset } from "@/lib/mannequin/presets/types";
import { clampProportion } from "@/lib/mannequin/proportions";
import { DOF_INDEX, type Dof, type SemanticAngles, clampDof } from "@/lib/mannequin/rom";
import { resolveFigureModel } from "@/lib/model-import/figure-model";
import {
  type FigureTransform,
  type MannequinModelRef,
  MannequinModelRefSchema,
  type MaterialStyle,
  type ProportionKey,
  type ProportionOverrides,
  type SceneCamera,
  type SceneDocument,
  type SceneEnvironment,
  type SceneLight,
  type SceneLock,
  type SceneMannequin,
  type Vec3,
  createDefaultScene,
  createSceneObjectId,
  parseScene,
} from "@/lib/scene";

import { kelvinToHex } from "../lib/color-temperature";
import {
  type SceneContent,
  canEditLights,
  canEditPose,
  canMoveCamera,
  changesLockedItems,
  isMasterLocked,
  lockNotice,
} from "./guards";

export type Tool = "rotate" | "drag" | "move";

export type Selection =
  | { kind: "none" }
  | { kind: "bone"; mannequinId: string; bone: PosableBoneName }
  | { kind: "mannequin"; mannequinId: string }
  | { kind: "light"; lightId: string };

export type Hover = { kind: "bone"; mannequinId: string; bone: HumanBoneName } | { kind: "light"; lightId: string } | null;

export type PersistenceStatus = "idle" | "dirty" | "saving" | "saved" | "offline" | "error" | "conflict";

export interface Persistence {
  mode: "guest" | "cloud";
  workspaceId: string | null;
  status: PersistenceStatus;
  lastSavedAt: string | null;
  baseUpdatedAt: string | null;
}

export type ViewPreset = "front" | "back" | "left" | "right" | "top" | "threeQuarterLeft" | "threeQuarterRight";

export type CameraCommand =
  | { id: number; kind: "view"; view: ViewPreset }
  | { id: number; kind: "frame" }
  | { id: number; kind: "set"; position: Vec3; target: Vec3; animate: boolean };

export interface Notice {
  id: number;
  message: string;
  tone: "info" | "warning";
  /** Notices of one group replace each other (e.g. lock status and "locked" refusals). */
  group?: "lock";
}

export interface CaptureOptions {
  /** Resolution multiplier of the viewport (1, 2 or 4); the longest edge is capped at 4096 px. */
  scale: number;
  transparent: boolean;
  includeFloor: boolean;
  includeBulbs: boolean;
  /** Optional output size (thumbnails); the viewport is cropped to this aspect ratio. */
  size?: { width: number; height: number };
  type?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
}

/** Something on the canvas the test hook / tooling can locate on screen (TEST_PLAN §6.1). */
export type ProjectTarget =
  | { kind: "bone"; mannequinId: string; bone: HumanBoneName }
  /** The joint pivot (bone origin) — the centre of its gizmo rings. */
  | { kind: "joint"; mannequinId: string; bone: HumanBoneName }
  /** A grabbable point on a ring of the gizmo currently shown (null when no such ring). */
  | { kind: "gizmoRing"; dof: Dof }
  | { kind: "light"; lightId: string }
  | { kind: "ikHandle"; mannequinId: string; effector: "leftHand" | "rightHand" | "leftFoot" | "rightFoot" | "head" | "hips" }
  | { kind: "world"; position: Vec3 };

/** Imperative hooks registered by the 3D canvas (not serialisable, never persisted). */
export interface EngineApi {
  capture?: (options: CaptureOptions) => Promise<Blob>;
  /** Page CSS-pixel position of a target; `visible` is false when off-screen or occluded. */
  project?: (target: ProjectTarget) => { x: number; y: number; visible: boolean } | null;
  /** Number of frames rendered so far (render-on-demand checks). */
  frameCount?: () => number;
  /** Renderer statistics of the last frame (performance / leak checks). */
  renderStats?: () => RenderStats;
  /** Frames the render loop still has to draw (0 = nothing pending: no animation, damping or edit). */
  pendingFrames?: () => number;
}

export interface RenderStats {
  /** Draw calls and triangles of the last rendered frame (all passes, incl. shadow maps). */
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Visible meshes in the scene graph. */
  meshes: number;
}

export interface EditorState {
  scene: SceneContent;
  camera: SceneCamera;
  selection: Selection;
  hover: Hover;
  tool: Tool;
  turntable: { enabled: boolean; speed: number };
  gestureActive: boolean;
  cameraCommand: CameraCommand | null;
  notice: Notice | null;
  persistence: Persistence;
  engine: EngineApi;
  /** Bumped whenever the canvas finished rendering a new state (test hook `ready`). */
  ready: boolean;
  /** Open dialog (UI only, not persisted). */
  dialog: EditorDialog;

  // ── document ───────────────────────────────────────────────────────────────────────────
  loadDocument: (input: unknown) => boolean;
  getDocument: () => SceneDocument;
  // ── selection & tools ──────────────────────────────────────────────────────────────────
  select: (selection: Selection) => void;
  clearSelection: () => void;
  setHover: (hover: Hover) => void;
  setTool: (tool: Tool) => void;
  // ── pose ───────────────────────────────────────────────────────────────────────────────
  setBoneAngles: (mannequinId: string, bone: PosableBoneName, angles: SemanticAngles) => void;
  setBoneDof: (mannequinId: string, bone: PosableBoneName, dof: Dof, value: number) => void;
  setPose: (mannequinId: string, pose: Pose) => void;
  resetBones: (mannequinId: string, bones: readonly PosableBoneName[]) => void;
  resetPose: (mannequinId: string, to: "neutral" | "default") => void;
  mirrorPose: (mannequinId: string, from: Side) => void;
  swapSides: (mannequinId: string) => void;
  applyPosePreset: (mannequinId: string, preset: PosePreset) => void;
  applyHandPreset: (mannequinId: string, preset: HandPreset, side: Side | "both") => void;
  /**
   * Applies a personal figure preset (PROJECT F15) as one undo step: the body (base preset,
   * proportions, material) unless the figure shows an imported model, and the pose when the preset
   * has one — keeping the figure's floor position and heading, like `applyPosePreset`.
   */
  applyFigurePreset: (mannequinId: string, data: FigurePresetData) => FigurePresetApplyResult;
  // ── figures ────────────────────────────────────────────────────────────────────────────
  addMannequin: (presetId?: string) => string | null;
  /** Adds a figure built from a personal preset (8-figure limit), named after it; returns its id. */
  addFigureFromPreset: (data: FigurePresetData, name?: string) => string | null;
  duplicateMannequin: (mannequinId: string) => string | null;
  removeMannequin: (mannequinId: string) => void;
  renameMannequin: (mannequinId: string, name: string) => void;
  setMannequinVisible: (mannequinId: string, visible: boolean) => void;
  setMannequinLocked: (mannequinId: string, locked: boolean) => void;
  setMannequinTransform: (mannequinId: string, transform: Partial<FigureTransform>) => void;
  dropToFloor: (mannequinId: string) => void;
  setBodyPreset: (mannequinId: string, presetId: string) => void;
  setProportion: (mannequinId: string, key: ProportionKey, value: number | null) => void;
  resetProportions: (mannequinId: string) => void;
  setMaterial: (mannequinId: string, material: Partial<{ style: MaterialStyle; color: string }>) => void;
  /**
   * Shows an imported model on a figure (`null` = back to the mannequin; ARCHITECTURE §9.11).
   * `options.proportions` replaces the figure's proportion overrides (the caller merges the ones
   * measured on the model, so the mannequin fallback matches it). Keeps the floor clearance.
   */
  setMannequinModel: (mannequinId: string, model: MannequinModelRef | null, options?: { proportions?: ProportionOverrides }) => void;
  // ── lights & environment ───────────────────────────────────────────────────────────────
  addLight: () => string | null;
  updateLight: (lightId: string, patch: Partial<Omit<SceneLight, "id" | "kind">>) => void;
  removeLight: (lightId: string) => void;
  setEnvironment: (patch: Partial<SceneEnvironment>) => void;
  // ── lock ───────────────────────────────────────────────────────────────────────────────
  setLock: (patch: Partial<SceneLock>) => void;
  toggleMasterLock: () => void;
  // ── history ────────────────────────────────────────────────────────────────────────────
  beginGesture: () => void;
  endGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  // ── camera & misc (not undoable) ───────────────────────────────────────────────────────
  setCamera: (camera: Partial<SceneCamera>) => void;
  requestView: (view: ViewPreset) => void;
  requestFrameSelection: () => void;
  /** Move the 3D camera (and the saved camera) to an explicit position/target. */
  placeCamera: (position: Vec3, target: Vec3, animate?: boolean) => void;
  setTurntable: (patch: Partial<{ enabled: boolean; speed: number }>) => void;
  notify: (message: string, tone?: Notice["tone"], group?: Notice["group"]) => void;
  setPersistence: (patch: Partial<Persistence>) => void;
  setEngine: (patch: Partial<EngineApi>) => void;
  setReady: (ready: boolean) => void;
  setDialog: (dialog: EditorDialog) => void;
}

export type EditorDialog = "none" | "help" | "export" | "addFigure";

/**
 * Outcome of `applyFigurePreset`: everything applied; only the pose (the figure shows an imported
 * model); nothing applicable (imported model, body-only preset); refused by the pose lock; or an
 * unreadable preset / unknown figure.
 */
export type FigurePresetApplyResult = "applied" | "pose-only" | "not-applicable" | "locked" | "invalid";

export type EditorStore = StoreApi<EditorState> & {
  temporal: StoreApi<{
    pastStates: { scene: SceneContent }[];
    futureStates: { scene: SceneContent }[];
    undo: (steps?: number) => void;
    redo: (steps?: number) => void;
    clear: () => void;
    pause: () => void;
    resume: () => void;
    isTracking: boolean;
  }>;
};

export const HISTORY_LIMIT = 100;
const FIGURE_SPACING = 0.8;
const MAX_SHADOW_CASTERS = 2;
/** Refusal for camera commands while the view lock is on. */
export const VIEW_LOCKED_NOTICE = "View locked — press V to unlock the camera";

/** Positions for added bulbs, all inside the default view: key (= default), fill, rim, bounce. */
const LIGHT_SLOTS: Vec3[] = [
  [1.1, 2.4, 0.9],
  [-1.0, 2.0, 0.3],
  [-1.3, 2.2, -1.5],
  [1.0, 0.7, 1.4],
];

/** Pose-clamp hook for `parseScene` (S1's contract) — out-of-range stored values are repaired. */
export const romPoseClampHook = (pose: Record<string, unknown>) => clampPose(pose);

export function splitDocument(doc: SceneDocument): { scene: SceneContent; camera: SceneCamera } {
  const { camera, ...scene } = doc;
  return { scene, camera };
}

/** Default editor scene: S1's default document + relaxed stand pose, grounded. */
export function createEditorDefaultScene(): SceneDocument {
  const doc = createDefaultScene();
  return {
    ...doc,
    mannequins: doc.mannequins.map((m) => groundMannequin({ ...m, pose: applyPosePresetToPose(m.pose, DEFAULT_POSE_PRESET) })),
  };
}

/** The figure's own model when an imported one is loaded on this device, else the mannequin. */
function figureModel(m: SceneMannequin) {
  return resolveFigureModel(m);
}

function groundMannequin(m: SceneMannequin): SceneMannequin {
  const y = groundedHipsHeight(figureModel(m), m.pose, m.transform.rotation);
  return { ...m, transform: { ...m.transform, position: [m.transform.position[0], round(y), m.transform.position[2]] } };
}

/** Keep the current clearance above the floor while the figure's shape changes. */
function keepClearance(before: SceneMannequin, after: SceneMannequin): SceneMannequin {
  const gap = before.transform.position[1] - groundedHipsHeight(figureModel(before), before.pose, before.transform.rotation);
  const y = groundedHipsHeight(figureModel(after), after.pose, after.transform.rotation) + Math.max(0, gap);
  return { ...after, transform: { ...after.transform, position: [after.transform.position[0], round(y), after.transform.position[2]] } };
}

/**
 * A full-body pose preset on a figure: bones, hips orientation relative to the figure's heading,
 * then grounded (default) or lifted to `hips.height` × the standing hips height. Floor x/z are kept.
 */
function withPosePreset(m: SceneMannequin, preset: PosePreset): SceneMannequin {
  const pose = roundPose(applyPosePresetToPose(m.pose, preset));
  const [pitch, yaw, roll] = preset.hips?.orientation ?? [0, 0, 0];
  const heading = m.transform.rotation[1];
  const rotation: Vec3 = [wrapDeg(pitch), wrapDeg(heading + yaw), wrapDeg(roll)];
  const next: SceneMannequin = { ...m, pose, transform: { ...m.transform, rotation } };
  if (preset.grounded ?? true) return groundMannequin(next);
  const standing = groundedHipsHeight(figureModel(next), {}, [0, 0, 0]);
  const y = standing * (preset.hips?.height ?? 1);
  return { ...next, transform: { ...next.transform, position: [m.transform.position[0], round(y), m.transform.position[2]] } };
}

/** A personal preset's name for a new figure (40 characters), made unique with " 2", " 3", … */
function figureNameFrom(existing: readonly string[], requested?: string): string {
  const base = requested?.trim().slice(0, FIGURE_NAME_MAX_LENGTH).trim();
  if (!base) return nextName(existing, "Figure");
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const name = `${base.slice(0, FIGURE_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!existing.includes(name)) return name;
  }
}

const round = (v: number, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

function roundPose(pose: Pose): Pose {
  const out: Pose = {};
  for (const [bone, a] of Object.entries(pose) as [PosableBoneName, SemanticAngles][]) {
    out[bone] = [round(a[0], 3), round(a[1], 3), round(a[2], 3)];
  }
  return out;
}

function nextName(existing: readonly string[], base: string): string {
  for (let i = 1; ; i++) {
    const name = `${base} ${i}`;
    if (!existing.includes(name)) return name;
  }
}

function freeSlotX(mannequins: readonly SceneMannequin[], near = 0): number {
  for (let k = 0; k < 40; k++) {
    const step = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1);
    const x = near + step * FIGURE_SPACING;
    if (mannequins.every((m) => Math.hypot(m.transform.position[0] - x, m.transform.position[2]) > FIGURE_SPACING * 0.75)) {
      return round(x);
    }
  }
  return round(near + mannequins.length * FIGURE_SPACING);
}

function wrapDeg(v: number): number {
  let a = ((v + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

export function createEditorStore(init: { document?: unknown; persistence?: Partial<Persistence> } = {}): EditorStore {
  const parsed = init.document !== undefined ? parseScene(init.document, { clampPose: romPoseClampHook }) : null;
  const initialDoc = parsed?.ok ? parsed.scene : createEditorDefaultScene();
  const { scene: initialScene, camera: initialCamera } = splitDocument(initialDoc);
  let noticeId = 0;
  let commandId = 0;
  let gestureSnapshot: SceneContent | null = null;

  const store = createStore<EditorState>()(
    temporal(
      (set, get) => {
        const notify = (message: string, tone: Notice["tone"] = "info", group?: Notice["group"]) =>
          set({ notice: { id: ++noticeId, message, tone, ...(group ? { group } : {}) } });

        const updateScene = (fn: (scene: SceneContent) => SceneContent) => {
          const current = get().scene;
          const next = fn(current);
          if (next !== current) set({ scene: next });
        };

        const updateMannequin = (id: string, fn: (m: SceneMannequin) => SceneMannequin) =>
          updateScene((scene) => {
            const idx = scene.mannequins.findIndex((m) => m.id === id);
            if (idx < 0) return scene;
            const next = fn(scene.mannequins[idx]);
            if (next === scene.mannequins[idx]) return scene;
            const mannequins = [...scene.mannequins];
            mannequins[idx] = next;
            return { ...scene, mannequins };
          });

        /** Pose-level edit with guard + clamp; returns false (and explains) when locked. */
        const guardPose = (id: string): boolean => {
          if (canEditPose(get().scene, id)) return true;
          if (!get().gestureActive) notify("Pose locked — unlock to edit", "warning", "lock");
          return false;
        };

        const guardLights = (): boolean => {
          if (canEditLights(get().scene)) return true;
          if (!get().gestureActive) notify("Lights locked — unlock to edit", "warning", "lock");
          return false;
        };

        const editPose = (id: string, fn: (pose: Pose, m: SceneMannequin) => Pose) => {
          if (!guardPose(id)) return;
          updateMannequin(id, (m) => {
            const pose = roundPose(fn(m.pose, m));
            return JSON.stringify(pose) === JSON.stringify(m.pose) ? m : { ...m, pose };
          });
        };

        /**
         * Lock flags are saved with the document but are NOT undo steps (PROJECT §10: undoing a
         * locked change must work right after unlocking). Apply the change untracked and rewrite
         * every history snapshot so undo/redo never toggles a lock.
         */
        const setUntracked = (fn: (scene: SceneContent) => SceneContent) => {
          const t = (store as EditorStore).temporal;
          const tracking = t.getState().isTracking;
          t.getState().pause();
          updateScene(fn);
          if (tracking) t.getState().resume();
          const { pastStates, futureStates } = t.getState();
          t.setState({
            pastStates: pastStates.map((s) => ({ scene: fn(s.scene) })),
            futureStates: futureStates.map((s) => ({ scene: fn(s.scene) })),
          });
          if (gestureSnapshot) gestureSnapshot = fn(gestureSnapshot);
        };

        /** Drop selections of items that no longer exist or became locked (PROJECT §10). */
        const sanitizeSelection = () => {
          const { selection, scene } = get();
          if (selection.kind === "bone" || selection.kind === "mannequin") {
            if (!canEditPose(scene, selection.mannequinId)) set({ selection: { kind: "none" } });
          } else if (selection.kind === "light") {
            if (!scene.lights.some((l) => l.id === selection.lightId) || !canEditLights(scene)) {
              set({ selection: { kind: "none" } });
            }
          }
        };

        return {
          scene: initialScene,
          camera: initialCamera,
          selection: { kind: "none" },
          hover: null,
          tool: "rotate",
          turntable: { enabled: false, speed: 1 },
          gestureActive: false,
          cameraCommand: null,
          notice: null,
          persistence: {
            mode: "guest",
            workspaceId: null,
            status: "idle",
            lastSavedAt: null,
            baseUpdatedAt: null,
            ...init.persistence,
          },
          engine: {},
          ready: false,
          dialog: "none",

          loadDocument: (input) => {
            const res = parseScene(input, { clampPose: romPoseClampHook });
            if (!res.ok) {
              notify("Could not load the scene — it is invalid", "warning");
              return false;
            }
            const { scene, camera } = splitDocument(res.scene);
            const { turntable } = get();
            set({
              scene,
              camera,
              selection: { kind: "none" },
              hover: null,
              cameraCommand: { id: ++commandId, kind: "set", position: [...camera.position], target: [...camera.target], animate: false },
              // A view-locked document keeps its angle: a running turntable stops.
              ...(scene.lock.view && turntable.enabled ? { turntable: { ...turntable, enabled: false } } : {}),
            });
            (store as EditorStore).temporal.getState().clear();
            return true;
          },

          getDocument: () => ({ ...get().scene, camera: get().camera }),

          select: (selection) => set({ selection }),
          clearSelection: () => set({ selection: { kind: "none" } }),
          setHover: (hover) => {
            const h = get().hover;
            if (JSON.stringify(h) !== JSON.stringify(hover)) set({ hover });
          },
          setTool: (tool) => set({ tool }),

          setBoneAngles: (id, bone, angles) => editPose(id, (pose) => setBoneAngles(pose, bone, angles)),
          setBoneDof: (id, bone, dof, value) =>
            editPose(id, (pose) => {
              const a = getAngles(pose, bone);
              a[DOF_INDEX[dof]] = clampDof(bone, dof, value);
              return setBoneAngles(pose, bone, a);
            }),
          setPose: (id, pose) => editPose(id, () => clampPose(pose)),
          resetBones: (id, bones) => editPose(id, (pose) => resetBones(pose, bones)),
          resetPose: (id, to) =>
            editPose(id, (pose) => (to === "neutral" ? {} : applyPosePresetToPose(pose, DEFAULT_POSE_PRESET))),
          mirrorPose: (id, from) => editPose(id, (pose) => mirrorPose(pose, from)),
          swapSides: (id) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => ({
              ...m,
              pose: roundPose(swapSides(m.pose)),
              transform: {
                ...m.transform,
                rotation: [m.transform.rotation[0], wrapDeg(-m.transform.rotation[1]), wrapDeg(-m.transform.rotation[2])] as Vec3,
              },
            }));
          },
          applyPosePreset: (id, preset) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => withPosePreset(m, preset));
          },
          applyHandPreset: (id, preset, side) => editPose(id, (pose) => applyHandPresetToPose(pose, preset, side)),
          applyFigurePreset: (id, input) => {
            const parsed = parseFigurePresetData(input, { mode: "read" });
            const figure = get().scene.mannequins.find((m) => m.id === id);
            if (!parsed.ok) notify("This preset can't be applied — it is damaged", "warning");
            if (!parsed.ok || !figure) return "invalid";
            const data = parsed.data;
            // An imported model keeps its own body (like the body presets); only a pose applies.
            const bodyApplies = !figure.model;
            if (!bodyApplies && !data.pose) return "not-applicable";
            if (!guardPose(id)) return "locked";
            const posePreset = posePresetOfFigurePreset("figure-preset", "Figure preset", data);
            updateMannequin(id, (m) => {
              const shaped: SceneMannequin = bodyApplies
                ? { ...m, presetId: data.body.presetId, proportions: proportionOverridesOf(data.body), material: { ...data.body.material } }
                : m;
              const next = posePreset ? withPosePreset(shaped, posePreset) : keepClearance(m, shaped);
              return JSON.stringify(next) === JSON.stringify(m) ? m : next;
            });
            return bodyApplies ? "applied" : "pose-only";
          },

          addMannequin: (presetId) => {
            const { scene } = get();
            if (scene.mannequins.length >= MAX_MANNEQUINS_PER_SCENE) {
              notify(`A scene can hold up to ${MAX_MANNEQUINS_PER_SCENE} figures`, "warning");
              return null;
            }
            const body = getBodyPreset(presetId ?? "classic-wooden");
            const id = createSceneObjectId("fig", [...scene.mannequins.map((m) => m.id), ...scene.lights.map((l) => l.id)]);
            const figure = groundMannequin({
              id,
              name: nextName(scene.mannequins.map((m) => m.name), "Figure"),
              presetId: body.id,
              proportions: {},
              material: { ...body.material },
              transform: { position: [freeSlotX(scene.mannequins), 1, 0], rotation: [0, 0, 0] },
              pose: roundPose(applyPosePresetToPose({}, DEFAULT_POSE_PRESET)),
              locked: false,
              visible: true,
            });
            set({ scene: { ...scene, mannequins: [...scene.mannequins, figure] }, selection: { kind: "mannequin", mannequinId: id } });
            return id;
          },
          addFigureFromPreset: (input, name) => {
            const parsed = parseFigurePresetData(input, { mode: "read" });
            if (!parsed.ok) {
              notify("This preset can't be used — it is damaged", "warning");
              return null;
            }
            const { scene } = get();
            if (scene.mannequins.length >= MAX_MANNEQUINS_PER_SCENE) {
              notify(`A scene can hold up to ${MAX_MANNEQUINS_PER_SCENE} figures`, "warning");
              return null;
            }
            const data = parsed.data;
            const id = createSceneObjectId("fig", [...scene.mannequins.map((m) => m.id), ...scene.lights.map((l) => l.id)]);
            const base: SceneMannequin = {
              id,
              name: figureNameFrom(scene.mannequins.map((m) => m.name), name),
              presetId: data.body.presetId,
              proportions: proportionOverridesOf(data.body),
              material: { ...data.body.material },
              transform: { position: [freeSlotX(scene.mannequins), 1, 0], rotation: [0, 0, 0] },
              pose: roundPose(applyPosePresetToPose({}, DEFAULT_POSE_PRESET)),
              locked: false,
              visible: true,
            };
            const posePreset = posePresetOfFigurePreset("figure-preset", "Figure preset", data);
            const figure = posePreset ? withPosePreset(base, posePreset) : groundMannequin(base);
            set({ scene: { ...scene, mannequins: [...scene.mannequins, figure] }, selection: { kind: "mannequin", mannequinId: id } });
            return id;
          },
          duplicateMannequin: (sourceId) => {
            const { scene } = get();
            const src = scene.mannequins.find((m) => m.id === sourceId);
            if (!src) return null;
            if (scene.mannequins.length >= MAX_MANNEQUINS_PER_SCENE) {
              notify(`A scene can hold up to ${MAX_MANNEQUINS_PER_SCENE} figures`, "warning");
              return null;
            }
            const id = createSceneObjectId("fig", [...scene.mannequins.map((m) => m.id), ...scene.lights.map((l) => l.id)]);
            const name = `${src.name} copy`.slice(0, 40);
            const copy: SceneMannequin = {
              ...structuredClone(src),
              id,
              name,
              locked: false,
              transform: {
                ...src.transform,
                position: [freeSlotX(scene.mannequins, src.transform.position[0]), src.transform.position[1], src.transform.position[2]],
              },
            };
            set({ scene: { ...scene, mannequins: [...scene.mannequins, copy] }, selection: { kind: "mannequin", mannequinId: id } });
            return id;
          },
          removeMannequin: (id) => {
            if (!guardPose(id)) return;
            updateScene((scene) => ({ ...scene, mannequins: scene.mannequins.filter((m) => m.id !== id) }));
            sanitizeSelection();
          },
          renameMannequin: (id, name) => {
            const trimmed = name.trim().slice(0, 40);
            if (!trimmed) return;
            updateMannequin(id, (m) => (m.name === trimmed ? m : { ...m, name: trimmed }));
          },
          setMannequinVisible: (id, visible) => updateMannequin(id, (m) => (m.visible === visible ? m : { ...m, visible })),
          setMannequinLocked: (id, locked) => {
            if (!get().scene.mannequins.some((m) => m.id === id && m.locked !== locked)) return;
            setUntracked((scene) => ({
              ...scene,
              mannequins: scene.mannequins.map((m) => (m.id === id && m.locked !== locked ? { ...m, locked } : m)),
            }));
            if (locked) {
              set({ hover: null });
              sanitizeSelection();
            }
          },
          setMannequinTransform: (id, patch) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => {
              const position = (patch.position ?? m.transform.position).map((v) => round(v)) as Vec3;
              const rotation = (patch.rotation ?? m.transform.rotation).map((v) => round(wrapDeg(v), 3)) as Vec3;
              if (JSON.stringify(position) === JSON.stringify(m.transform.position) && JSON.stringify(rotation) === JSON.stringify(m.transform.rotation)) {
                return m;
              }
              return { ...m, transform: { position, rotation } };
            });
          },
          dropToFloor: (id) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => {
              const next = groundMannequin(m);
              return next.transform.position[1] === m.transform.position[1] ? m : next;
            });
          },
          setBodyPreset: (id, presetId) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => {
              if (m.presetId === presetId) return m;
              const body = getBodyPreset(presetId);
              return keepClearance(m, { ...m, presetId: body.id, proportions: {}, material: { ...body.material } });
            });
          },
          setProportion: (id, key, value) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => {
              const proportions = { ...m.proportions };
              if (value === null) delete proportions[key];
              else proportions[key] = round(clampProportion(key, value), 4);
              if (JSON.stringify(proportions) === JSON.stringify(m.proportions)) return m;
              return keepClearance(m, { ...m, proportions });
            });
          },
          resetProportions: (id) => {
            if (!guardPose(id)) return;
            updateMannequin(id, (m) => (Object.keys(m.proportions).length === 0 ? m : keepClearance(m, { ...m, proportions: {} })));
          },
          setMannequinModel: (id, model, options) => {
            if (!guardPose(id)) return;
            const ref = model ? MannequinModelRefSchema.safeParse(model) : null;
            if (ref && !ref.success) return;
            updateMannequin(id, (m) => {
              let proportions = m.proportions;
              if (options?.proportions) {
                proportions = {};
                for (const [key, value] of Object.entries(options.proportions) as [ProportionKey, number | undefined][]) {
                  if (typeof value === "number" && Number.isFinite(value)) proportions[key] = round(clampProportion(key, value), 4);
                }
              }
              const next: SceneMannequin = { ...m, proportions };
              if (ref) next.model = ref.data;
              else delete next.model;
              return JSON.stringify(next) === JSON.stringify(m) ? m : keepClearance(m, next);
            });
          },
          setMaterial: (id, material) =>
            updateMannequin(id, (m) => {
              const next = { ...m.material, ...material };
              // A style switch keeps a custom tint but follows the style's default tint otherwise.
              if (
                material.style &&
                material.color === undefined &&
                m.material.color.toLowerCase() === MATERIAL_DEFAULT_COLORS[m.material.style]
              ) {
                next.color = MATERIAL_DEFAULT_COLORS[material.style];
              }
              if (next.color) next.color = next.color.toLowerCase();
              return next.style === m.material.style && next.color === m.material.color ? m : { ...m, material: next };
            }),

          addLight: () => {
            if (!guardLights()) return null;
            const { scene } = get();
            if (scene.lights.length >= MAX_LIGHTS_PER_SCENE) {
              notify(`A scene can hold up to ${MAX_LIGHTS_PER_SCENE} lights`, "warning");
              return null;
            }
            const id = createSceneObjectId("light", [...scene.mannequins.map((m) => m.id), ...scene.lights.map((l) => l.id)]);
            const used = scene.lights.map((l) => l.position);
            const slot =
              LIGHT_SLOTS.find((s) => used.every((p) => Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) > 0.5)) ?? LIGHT_SLOTS[0];
            const casters = scene.lights.filter((l) => l.castShadow).length;
            const light: SceneLight = {
              id,
              name: nextName(scene.lights.map((l) => l.name), "Light"),
              kind: "bulb",
              position: [...slot],
              intensity: 0.5,
              colorTemperature: 5000,
              color: kelvinToHex(5000),
              castShadow: casters < MAX_SHADOW_CASTERS,
              shadowSoftness: 0.4,
              visible: true,
            };
            set({ scene: { ...scene, lights: [...scene.lights, light] }, selection: { kind: "light", lightId: id } });
            return id;
          },
          updateLight: (id, patch) => {
            if (!guardLights()) return;
            updateScene((scene) => {
              const idx = scene.lights.findIndex((l) => l.id === id);
              if (idx < 0) return scene;
              const cur = scene.lights[idx];
              const next: SceneLight = { ...cur, ...patch };
              if (patch.position) next.position = patch.position.map((v) => round(Math.max(-50, Math.min(50, v)))) as Vec3;
              if (patch.intensity !== undefined) next.intensity = round(Math.min(1, Math.max(0, patch.intensity)), 4);
              if (patch.shadowSoftness !== undefined) next.shadowSoftness = round(Math.min(1, Math.max(0, patch.shadowSoftness)), 4);
              if (patch.colorTemperature !== undefined && patch.colorTemperature !== null) {
                next.colorTemperature = Math.round(Math.min(10000, Math.max(2000, patch.colorTemperature)));
                next.color = kelvinToHex(next.colorTemperature);
              } else if (patch.color !== undefined && patch.colorTemperature === undefined) {
                next.colorTemperature = null;
                next.color = patch.color.toLowerCase();
              }
              if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 40) || cur.name;
              if (JSON.stringify(next) === JSON.stringify(cur)) return scene;
              const lights = [...scene.lights];
              lights[idx] = next;
              return { ...scene, lights };
            });
            const casters = get().scene.lights.filter((l) => l.castShadow).length;
            if (patch.castShadow && casters > MAX_SHADOW_CASTERS) {
              notify("More than two shadow-casting lights can slow down rendering", "warning");
            }
          },
          removeLight: (id) => {
            if (!guardLights()) return;
            updateScene((scene) => ({ ...scene, lights: scene.lights.filter((l) => l.id !== id) }));
            sanitizeSelection();
          },
          setEnvironment: (patch) =>
            updateScene((scene) => {
              const environment: SceneEnvironment = {
                ...scene.environment,
                ...patch,
                floor: { ...scene.environment.floor, ...patch.floor },
              };
              if (patch.ambient !== undefined) environment.ambient = round(Math.min(1, Math.max(0, patch.ambient)), 4);
              if (patch.background) environment.background = patch.background.toLowerCase();
              return JSON.stringify(environment) === JSON.stringify(scene.environment) ? scene : { ...scene, environment };
            }),

          setLock: (patch) => {
            const before = get().scene.lock;
            const lock = { ...before, ...patch };
            if (lock.pose === before.pose && lock.lights === before.lights && lock.view === before.view) return;
            setUntracked((scene) => ({ ...scene, lock }));
            set({ hover: null });
            sanitizeSelection();
            // The view lock keeps the exact angle: a running turntable stops.
            if (lock.view && get().turntable.enabled) set({ turntable: { ...get().turntable, enabled: false } });
            notify(lockNotice(lock), "info", "lock");
          },
          toggleMasterLock: () => {
            const locked = isMasterLocked(get().scene.lock);
            get().setLock({ pose: !locked, lights: !locked, view: !locked });
          },

          beginGesture: () => {
            if (get().gestureActive) return;
            gestureSnapshot = get().scene;
            (store as EditorStore).temporal.getState().pause();
            set({ gestureActive: true });
          },
          endGesture: () => {
            if (!get().gestureActive) return;
            const t = (store as EditorStore).temporal;
            t.getState().resume();
            const snapshot = gestureSnapshot;
            gestureSnapshot = null;
            set({ gestureActive: false });
            if (snapshot && snapshot !== get().scene) {
              const past = [...t.getState().pastStates, { scene: snapshot }];
              while (past.length > HISTORY_LIMIT) past.shift();
              t.setState({ pastStates: past, futureStates: [] });
            }
          },
          cancelGesture: () => {
            if (!get().gestureActive) return;
            const snapshot = gestureSnapshot;
            gestureSnapshot = null;
            if (snapshot) set({ scene: snapshot });
            (store as EditorStore).temporal.getState().resume();
            set({ gestureActive: false });
          },
          undo: () => {
            const t = (store as EditorStore).temporal.getState();
            const target = t.pastStates[t.pastStates.length - 1];
            if (!target || get().gestureActive) return;
            if (changesLockedItems(get().scene, target.scene)) {
              notify("Unlock to undo changes to locked items", "warning", "lock");
              return;
            }
            t.undo();
            sanitizeSelection();
          },
          redo: () => {
            const t = (store as EditorStore).temporal.getState();
            const target = t.futureStates[t.futureStates.length - 1];
            if (!target || get().gestureActive) return;
            if (changesLockedItems(get().scene, target.scene)) {
              notify("Unlock to redo changes to locked items", "warning", "lock");
              return;
            }
            t.redo();
            sanitizeSelection();
          },

          // View lock (PROJECT F6): commands that would move the camera or change the lens are refused.
          // The camera rig's own saves (position/target) still pass: input is disabled while locked,
          // so they only record the locked angle.
          setCamera: (camera) => {
            const current = get().camera;
            if (camera.focalLength !== undefined && camera.focalLength !== current.focalLength && !canMoveCamera(get().scene)) {
              notify(VIEW_LOCKED_NOTICE, "warning", "lock");
              return;
            }
            const next = { ...current, ...camera };
            // No-op saves (e.g. a click on the background, locking an already saved angle) must not
            // look like a document change to autosave.
            if (JSON.stringify(next) !== JSON.stringify(current)) set({ camera: next });
          },
          requestView: (view) => {
            if (!canMoveCamera(get().scene)) return notify(VIEW_LOCKED_NOTICE, "warning", "lock");
            set({ cameraCommand: { id: ++commandId, kind: "view", view } });
          },
          requestFrameSelection: () => {
            if (!canMoveCamera(get().scene)) return notify(VIEW_LOCKED_NOTICE, "warning", "lock");
            set({ cameraCommand: { id: ++commandId, kind: "frame" } });
          },
          placeCamera: (position, target, animate = false) => {
            if (!canMoveCamera(get().scene)) return notify(VIEW_LOCKED_NOTICE, "warning", "lock");
            set({
              camera: { ...get().camera, position: [...position], target: [...target] },
              cameraCommand: { id: ++commandId, kind: "set", position: [...position], target: [...target], animate },
            });
          },
          setTurntable: (patch) => {
            if (patch.enabled && !canMoveCamera(get().scene)) return notify(VIEW_LOCKED_NOTICE, "warning", "lock");
            set({ turntable: { ...get().turntable, ...patch } });
          },
          notify,
          setPersistence: (patch) => set({ persistence: { ...get().persistence, ...patch } }),
          setEngine: (patch) => set({ engine: { ...get().engine, ...patch } }),
          setReady: (ready) => {
            if (get().ready !== ready) set({ ready });
          },
          setDialog: (dialog) => set({ dialog }),
        };
      },
      {
        partialize: (state) => ({ scene: state.scene }),
        equality: (a, b) => a.scene === b.scene,
        limit: HISTORY_LIMIT,
      },
    ),
  ) as EditorStore;

  return store;
}

/** Subscribe to persisted-document changes (scene or camera) — the hook S4's autosave uses. */
export function subscribeToDocument(store: EditorStore, listener: (doc: SceneDocument) => void): () => void {
  return store.subscribe((state, prev) => {
    if (state.scene !== prev.scene || state.camera !== prev.camera) listener(state.getDocument());
  });
}
