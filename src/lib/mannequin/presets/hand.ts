/**
 * Hand presets (PROJECT F10). Semantic `[flex, twist, side]` degrees per PROJECT §7.4, identical for
 * the left and right hand:
 * - `*Proximal` (MCP): flex + / hyperextension −; side + = spread away from the middle finger
 *   (middle finger: + toward the thumb, − toward the little finger).
 * - `*Intermediate` (PIP), `*Distal` (DIP / thumb IP): flex only.
 * - `ThumbMetacarpal` (CMC): flex + across the palm / − radial extension; twist + = opposition;
 *   side + = palmar abduction (away from the palm).
 * Finger flexion increases from the index to the little finger (the natural "cascade").
 */
import type { HandPreset } from "./types";

export const HAND_RELAXED: HandPreset = {
  id: "relaxed",
  name: "Relaxed",
  fingers: {
    ThumbMetacarpal: [10, 12, 18],
    ThumbProximal: [10, 0, 0],
    ThumbDistal: [12, 0, 0],
    IndexProximal: [12, 0, 3],
    IndexIntermediate: [22, 0, 0],
    IndexDistal: [8, 0, 0],
    MiddleProximal: [15, 0, 0],
    MiddleIntermediate: [27, 0, 0],
    MiddleDistal: [10, 0, 0],
    RingProximal: [19, 0, 3],
    RingIntermediate: [31, 0, 0],
    RingDistal: [12, 0, 0],
    LittleProximal: [24, 0, 7],
    LittleIntermediate: [36, 0, 0],
    LittleDistal: [15, 0, 0],
  },
  tags: ["default", "rest"],
};

export const HAND_FIST: HandPreset = {
  id: "fist",
  name: "Fist",
  fingers: {
    // Thumb wraps over the middle phalanges of the index and middle fingers.
    ThumbMetacarpal: [14, 45, 4],
    ThumbProximal: [37, 0, 0],
    ThumbDistal: [29, 0, 0],
    IndexProximal: [88, 0, 0],
    IndexIntermediate: [100, 0, 0],
    IndexDistal: [60, 0, 0],
    MiddleProximal: [90, 0, 0],
    MiddleIntermediate: [102, 0, 0],
    MiddleDistal: [62, 0, 0],
    RingProximal: [90, 0, -2],
    RingIntermediate: [102, 0, 0],
    RingDistal: [60, 0, 0],
    LittleProximal: [90, 0, -4],
    LittleIntermediate: [98, 0, 0],
    LittleDistal: [55, 0, 0],
  },
  tags: ["closed", "action"],
};

export const HAND_OPEN: HandPreset = {
  id: "open",
  name: "Open (spread)",
  fingers: {
    // Thumb extended radially, close to the plane of the palm.
    ThumbMetacarpal: [-25, 0, 0],
    ThumbProximal: [-5, 0, 0],
    ThumbDistal: [-10, 0, 0],
    IndexProximal: [-5, 0, 14],
    MiddleProximal: [-5, 0, 0],
    RingProximal: [-5, 0, 10],
    LittleProximal: [-8, 0, 18],
  },
  tags: ["open"],
};

export const HAND_FLAT: HandPreset = {
  id: "flat",
  name: "Flat (fingers together)",
  fingers: {
    ThumbMetacarpal: [0, 5, 5],
    ThumbProximal: [5, 0, 0],
    ThumbDistal: [5, 0, 0],
    IndexProximal: [3, 0, -3],
    IndexIntermediate: [3, 0, 0],
    MiddleProximal: [3, 0, 0],
    MiddleIntermediate: [3, 0, 0],
    RingProximal: [3, 0, -3],
    RingIntermediate: [3, 0, 0],
    LittleProximal: [3, 0, -4],
    LittleIntermediate: [3, 0, 0],
  },
  tags: ["open"],
};

export const HAND_POINT: HandPreset = {
  id: "point",
  name: "Point",
  fingers: {
    // Thumb rests on the curled middle finger.
    ThumbMetacarpal: [14, 38, 7],
    ThumbProximal: [32, 0, 0],
    ThumbDistal: [22, 0, 0],
    IndexProximal: [5, 0, 0],
    IndexIntermediate: [5, 0, 0],
    MiddleProximal: [85, 0, 0],
    MiddleIntermediate: [100, 0, 0],
    MiddleDistal: [55, 0, 0],
    RingProximal: [88, 0, -2],
    RingIntermediate: [100, 0, 0],
    RingDistal: [55, 0, 0],
    LittleProximal: [88, 0, -4],
    LittleIntermediate: [95, 0, 0],
    LittleDistal: [50, 0, 0],
  },
  tags: ["gesture"],
};

export const HAND_PEACE: HandPreset = {
  id: "peace",
  name: "Peace (V)",
  fingers: {
    // Thumb holds the curled ring and little fingers down.
    ThumbMetacarpal: [40, 40, 15],
    ThumbProximal: [40, 0, 0],
    ThumbDistal: [30, 0, 0],
    IndexProximal: [0, 0, 12],
    MiddleProximal: [0, 0, -10],
    RingProximal: [85, 0, 0],
    RingIntermediate: [100, 0, 0],
    RingDistal: [55, 0, 0],
    LittleProximal: [88, 0, -2],
    LittleIntermediate: [95, 0, 0],
    LittleDistal: [50, 0, 0],
  },
  tags: ["gesture"],
};

export const HAND_THUMBS_UP: HandPreset = {
  id: "thumbs-up",
  name: "Thumbs up",
  fingers: {
    // Thumb extended out to the radial side, away from the closed fingers.
    ThumbMetacarpal: [-25, 1, 4],
    ThumbProximal: [-10, 0, 0],
    ThumbDistal: [-20, 0, 0],
    IndexProximal: [85, 0, 0],
    IndexIntermediate: [100, 0, 0],
    IndexDistal: [60, 0, 0],
    MiddleProximal: [90, 0, 0],
    MiddleIntermediate: [102, 0, 0],
    MiddleDistal: [62, 0, 0],
    RingProximal: [90, 0, -2],
    RingIntermediate: [102, 0, 0],
    RingDistal: [60, 0, 0],
    LittleProximal: [90, 0, -4],
    LittleIntermediate: [98, 0, 0],
    LittleDistal: [55, 0, 0],
  },
  tags: ["gesture"],
};

export const HAND_GRIP: HandPreset = {
  id: "grip",
  name: "Grip (handle)",
  fingers: {
    // Cylindrical power grip around a ~4 cm handle; the thumb closes over the index.
    ThumbMetacarpal: [9, 39, 13],
    ThumbProximal: [10, 0, 0],
    ThumbDistal: [16, 0, 0],
    IndexProximal: [55, 0, 0],
    IndexIntermediate: [75, 0, 0],
    IndexDistal: [40, 0, 0],
    MiddleProximal: [60, 0, 0],
    MiddleIntermediate: [78, 0, 0],
    MiddleDistal: [42, 0, 0],
    RingProximal: [62, 0, -2],
    RingIntermediate: [78, 0, 0],
    RingDistal: [42, 0, 0],
    LittleProximal: [66, 0, -4],
    LittleIntermediate: [78, 0, 0],
    LittleDistal: [40, 0, 0],
  },
  tags: ["closed", "holding"],
};

export const HAND_PINCH: HandPreset = {
  id: "pinch",
  name: "Pinch",
  fingers: {
    // Precision tip-to-tip pinch between thumb and index; other fingers gently curled.
    ThumbMetacarpal: [11, 44, 22],
    ThumbProximal: [7, 0, 0],
    ThumbDistal: [9, 0, 0],
    IndexProximal: [51, 0, 0],
    IndexIntermediate: [57, 0, 0],
    IndexDistal: [26, 0, 0],
    MiddleProximal: [35, 0, 0],
    MiddleIntermediate: [45, 0, 0],
    MiddleDistal: [15, 0, 0],
    RingProximal: [40, 0, 0],
    RingIntermediate: [50, 0, 0],
    RingDistal: [18, 0, 0],
    LittleProximal: [45, 0, 2],
    LittleIntermediate: [55, 0, 0],
    LittleDistal: [20, 0, 0],
  },
  tags: ["holding"],
};

export const HAND_CLAW: HandPreset = {
  id: "claw",
  name: "Claw",
  fingers: {
    // Knuckles nearly straight, middle and tip joints strongly bent, fingers spread; the thumb
    // curls toward the fingertips as if holding a large ball.
    ThumbMetacarpal: [0, 20, 25],
    ThumbProximal: [20, 0, 0],
    ThumbDistal: [45, 0, 0],
    IndexProximal: [20, 0, 12],
    IndexIntermediate: [85, 0, 0],
    IndexDistal: [60, 0, 0],
    MiddleProximal: [20, 0, 0],
    MiddleIntermediate: [90, 0, 0],
    MiddleDistal: [60, 0, 0],
    RingProximal: [20, 0, 10],
    RingIntermediate: [90, 0, 0],
    RingDistal: [60, 0, 0],
    LittleProximal: [20, 0, 16],
    LittleIntermediate: [85, 0, 0],
    LittleDistal: [55, 0, 0],
  },
  tags: ["action"],
};

export const HAND_PRESETS: readonly HandPreset[] = [
  HAND_RELAXED,
  HAND_FIST,
  HAND_OPEN,
  HAND_FLAT,
  HAND_POINT,
  HAND_PEACE,
  HAND_THUMBS_UP,
  HAND_GRIP,
  HAND_PINCH,
  HAND_CLAW,
];

export const DEFAULT_HAND_PRESET = HAND_RELAXED;

/** @deprecated Engine-era alias of {@link HAND_PRESETS}. */
export const ENGINE_HAND_PRESETS = HAND_PRESETS;
