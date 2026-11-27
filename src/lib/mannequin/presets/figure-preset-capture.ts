/**
 * Figure → personal preset document ("Save as my preset", PROJECT F15). Separate from
 * `figure-preset.ts` because grounding needs the figure's mesh model, which the server never loads.
 */

import type { SceneMannequin } from "@/lib/scene";

import { type FigureModel, groundedHipsHeight } from "../figure-model";
import { clampPose, compactPose } from "../pose-math";
import { resolveProportions } from "../proportions";
import { getBodyPreset } from "./body";
import {
  FIGURE_PRESET_HEIGHT_RANGE,
  FIGURE_PRESET_VERSION,
  type FigurePresetData,
  roundProportions,
} from "./figure-preset";

/** A figure this close to its grounded height counts as standing on the floor. */
export const GROUND_TOLERANCE_METERS = 0.002;

export interface CaptureFigurePresetOptions {
  /** Save the pose and hands too (the save dialog's "Include pose and hands"). */
  includePose: boolean;
  /** The figure's current model (`resolveFigureModel(m)`), used to tell "on the floor" apart. */
  model: FigureModel;
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
};

/**
 * The preset document of a figure: base body preset, full proportions and material, plus — when
 * asked — its pose, the hips pitch/roll (the heading stays with the figure) and either "grounded"
 * or the hips height relative to the standing hips height. The figure's name, place, heading,
 * visibility, lock and imported model are never part of it.
 */
export function figurePresetFromMannequin(
  m: Pick<SceneMannequin, "presetId" | "proportions" | "material" | "pose" | "transform">,
  options: CaptureFigurePresetOptions,
): FigurePresetData {
  const base = getBodyPreset(m.presetId);
  const data: FigurePresetData = {
    version: FIGURE_PRESET_VERSION,
    body: {
      presetId: base.id,
      proportions: roundProportions(resolveProportions(base.proportions, m.proportions)),
      material: { style: m.material.style, color: m.material.color.toLowerCase() },
    },
  };
  if (!options.includePose) return data;

  const [pitch, , roll] = m.transform.rotation;
  const y = m.transform.position[1];
  const groundedY = groundedHipsHeight(options.model, m.pose, m.transform.rotation);
  const grounded = Math.abs(y - groundedY) <= GROUND_TOLERANCE_METERS;
  const orientation: [number, number, number] = [round(pitch, 3), 0, round(roll, 3)];
  let height: number | undefined;
  if (!grounded) {
    const standing = groundedHipsHeight(options.model, {}, [0, 0, 0]);
    const ratio = standing > 0 ? y / standing : 1;
    height = round(
      Math.min(FIGURE_PRESET_HEIGHT_RANGE.max, Math.max(FIGURE_PRESET_HEIGHT_RANGE.min, ratio)),
      4,
    );
  }
  return {
    ...data,
    pose: {
      pose: compactPose(clampPose(m.pose)),
      hips: height === undefined ? { orientation } : { orientation, height },
      grounded,
    },
  };
}
