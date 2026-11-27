/**
 * Full-body pose presets (PROJECT F10) in semantic form (PROJECT §7.4, ARCHITECTURE §9.10).
 *
 * Conventions recap — `[flex, twist, side]` degrees, same meaning on both sides:
 * - spine/chest/neck/head: flex + forward · twist + toward the figure's left · side + bend left
 * - *Shoulder: twist + protraction · side + elevation
 * - *UpperArm / *UpperLeg: flex + forward · twist + internal rotation · side + abduction
 * - *LowerArm: flex + elbow flexion · twist + pronation
 * - *Hand: flex + toward the palm · side + radial deviation
 * - *LowerLeg: flex + knee flexion · *Foot: flex + plantarflexion, twist + toe-in, side + inversion
 * - *Toes: flex + curl down / − extension (on the ball of the foot)
 * - hips.orientation `[pitch, yaw, roll]`: pitch + tip forward · yaw + turn left · roll + lean left
 *   (left hip drops). Yaw stays 0: the figure's heading is kept when a preset is applied.
 *
 * Values were tuned against the engine's forward kinematics and skinned mesh (`pose-analysis.ts`)
 * for floor contact, balance over the support, self-intersection and hand placement — see
 * `pose-plausibility.test.ts`. Sagittal rule of thumb for a foot flat on the floor:
 *   ankle flex = hip flex − hips pitch − knee flex.
 * Generic poses only: no character-specific or trademark poses (PROJECT §15).
 */
import { HAND_FIST, HAND_FLAT, HAND_GRIP, HAND_OPEN, HAND_RELAXED } from "./hand";
import type { FingerBoneSuffix, HandPreset, PosePreset, SemanticAngles } from "./types";

type BodyPose = PosePreset["pose"];

/** Expands hand presets into finger-bone entries of a full-body pose (`includesHands: true`). */
function hands(left: HandPreset, right: HandPreset = left): BodyPose {
  const pose: BodyPose = {};
  for (const [suffix, angles] of Object.entries(left.fingers) as [FingerBoneSuffix, SemanticAngles][]) {
    pose[`left${suffix}`] = [...angles];
  }
  for (const [suffix, angles] of Object.entries(right.fingers) as [FingerBoneSuffix, SemanticAngles][]) {
    pose[`right${suffix}`] = [...angles];
  }
  return pose;
}

/**
 * Default pose of new figures (PROJECT §7.1). It has no hips orientation on purpose: the editor
 * also applies it as a plain pose (new figure, "Reset to default"), which keeps the root upright.
 */
export const POSE_RELAXED_STAND: PosePreset = {
  id: "relaxed-stand",
  name: "Relaxed stand",
  category: "standing",
  includesHands: true,
  tags: ["default", "weight-right"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [0, 0, -2],
    chest: [3, 0, -1],
    neck: [-3, -4, 1],
    head: [2, 0, 2],
    leftShoulder: [0, 2, -1],
    rightShoulder: [0, 2, -3],
    leftUpperArm: [3, 0, 6],
    leftLowerArm: [12, 15, 0],
    leftHand: [6, 0, -4],
    rightUpperArm: [5, 3, 8],
    rightLowerArm: [16, 20, 0],
    rightHand: [8, 0, -3],
    leftUpperLeg: [7, -2, 4],
    leftLowerLeg: [14, 0, 0],
    leftFoot: [-7, 0, -2],
    rightUpperLeg: [0, -4, -3],
    rightFoot: [0, 0, 1],
  },
};

/** Reference poses: straight fingers (`includesHands` without finger entries resets them). */
export const POSE_T_POSE: PosePreset = {
  id: "t-pose",
  name: "T-pose",
  category: "standing",
  includesHands: true,
  tags: ["symmetric", "reference"],
  pose: {
    leftUpperArm: [0, 0, 90],
    rightUpperArm: [0, 0, 90],
  },
};

export const POSE_A_POSE: PosePreset = {
  id: "a-pose",
  name: "A-pose",
  category: "standing",
  includesHands: true,
  tags: ["symmetric", "reference"],
  pose: {
    leftUpperArm: [0, 0, 45],
    rightUpperArm: [0, 0, 45],
  },
};

export const POSE_CONTRAPPOSTO: PosePreset = {
  id: "contrapposto",
  name: "Contrapposto",
  category: "standing",
  // Weight on the right leg: the free (left) hip drops, the shoulders tilt the opposite way.
  hips: { orientation: [0, 0, 6] },
  includesHands: true,
  tags: ["weight-right", "classic"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [2, 0, -7],
    chest: [3, 3, -6],
    neck: [-3, -10, 4],
    head: [4, -6, -3],
    leftShoulder: [0, 2, 3],
    rightShoulder: [0, 0, -5],
    leftUpperArm: [8, 0, 0],
    leftLowerArm: [25, 25, 0],
    leftHand: [10, 0, -2],
    rightUpperArm: [4, 4, 12],
    rightLowerArm: [12, 20, 0],
    rightHand: [6, 0, -4],
    leftUpperLeg: [24, 5, 18],
    leftLowerLeg: [39, 0, 0],
    leftFoot: [-2, 0, 7],
    leftToes: [-9, 0, 0],
    rightUpperLeg: [-2, -5, -14],
    rightFoot: [-3, 0, -13],
  },
};

export const POSE_WALK: PosePreset = {
  id: "walk",
  name: "Walk",
  category: "locomotion",
  // Double support: left heel strike, right push-off; arms swing opposite to the legs.
  hips: { orientation: [3, 0, 0] },
  includesHands: true,
  tags: ["dynamic", "left-foot-forward"],
  pose: {
    ...hands(HAND_RELAXED),
    chest: [0, 6, 0],
    neck: [-2, -3, 0],
    head: [-1, -2, 0],
    leftUpperArm: [-18, 0, 6],
    leftLowerArm: [10, 10, 0],
    leftHand: [5, 0, -3],
    rightUpperArm: [20, 0, 6],
    rightLowerArm: [25, 15, 0],
    rightHand: [5, 0, -3],
    leftUpperLeg: [27, 0, 0],
    leftLowerLeg: [2, 0, 0],
    leftFoot: [-1, 0, 0],
    rightUpperLeg: [-12, 0, 0],
    rightLowerLeg: [27, 0, 0],
    rightFoot: [-19, 0, 0],
    rightToes: [-14, 0, 0],
  },
};

export const POSE_RUN: PosePreset = {
  id: "run",
  name: "Run",
  category: "locomotion",
  // Drive phase: right foot pushes off on its ball, left knee driven forward, trunk leaning in.
  hips: { orientation: [10, 0, 0] },
  includesHands: true,
  tags: ["dynamic", "left-knee-up"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [5, 4, 0],
    chest: [3, 8, 0],
    neck: [-8, -6, 0],
    head: [-5, -3, 0],
    leftUpperArm: [-40, 0, 10],
    leftLowerArm: [85, 10, 0],
    rightUpperArm: [45, 5, 8],
    rightLowerArm: [95, 10, 0],
    leftUpperLeg: [85, 0, 0],
    leftLowerLeg: [105, 0, 0],
    leftFoot: [20, 0, 0],
    rightUpperLeg: [-10, 0, 0],
    rightLowerLeg: [15, 0, 0],
    rightFoot: [10, 0, 0],
    rightToes: [-45, 0, 0],
  },
};

export const POSE_JUMP: PosePreset = {
  id: "jump",
  name: "Jump",
  category: "action",
  grounded: false,
  hips: { orientation: [0, 0, 0], height: 1.12 },
  includesHands: true,
  tags: ["dynamic", "airborne"],
  pose: {
    ...hands(HAND_OPEN),
    spine: [-5, 0, 0],
    chest: [-3, 0, 0],
    neck: [-8, 0, 0],
    head: [-4, 0, 0],
    leftUpperArm: [92, -51, 106],
    leftLowerArm: [12, 0, 0],
    rightUpperArm: [93, -48, 107],
    rightLowerArm: [10, 0, 0],
    leftUpperLeg: [20, 0, 5],
    leftLowerLeg: [100, 0, 0],
    leftFoot: [35, 0, 0],
    leftToes: [10, 0, 0],
    rightUpperLeg: [30, 0, 5],
    rightLowerLeg: [110, 0, 0],
    rightFoot: [30, 0, 0],
    rightToes: [10, 0, 0],
  },
};

export const POSE_SIT_ON_CHAIR: PosePreset = {
  id: "sit-on-chair",
  name: "Sit on chair",
  category: "sitting",
  // Feet flat, thighs level at seat height (~0.45 m for the default body); palms on the thighs.
  hips: { orientation: [-5, 0, 0] },
  includesHands: true,
  tags: ["seated", "chair-height-0.45m"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [5, 0, 0],
    chest: [-3, 0, 0],
    neck: [3, 0, 0],
    head: [2, 0, 0],
    leftUpperArm: [4, 23, 6],
    leftLowerArm: [68, 44, 0],
    leftHand: [-12, 0, -5],
    rightUpperArm: [4, 22, 5],
    rightLowerArm: [68, 62, 0],
    rightHand: [-9, 0, -8],
    leftUpperLeg: [85, -5, 6],
    leftLowerLeg: [78, 0, 0],
    leftFoot: [12, 0, 0],
    rightUpperLeg: [85, -5, 6],
    rightLowerLeg: [95, 0, 0],
    rightFoot: [-5, 0, 0],
  },
};

export const POSE_SIT_CROSS_LEGGED: PosePreset = {
  id: "sit-cross-legged",
  name: "Sit cross-legged",
  category: "sitting",
  hips: { orientation: [-15, 0, 0] },
  includesHands: true,
  tags: ["seated", "floor"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [21, 0, 0],
    chest: [6, 0, 0],
    neck: [-6, 0, 0],
    leftUpperArm: [-2, -10, 35],
    leftLowerArm: [112, 54, 0],
    leftHand: [5, 0, 0],
    rightUpperArm: [-2, -10, 35],
    rightLowerArm: [112, 52, 0],
    rightHand: [5, 0, 0],
    // Needs the Euler hip (flex → side → twist): thighs flexed, abducted and externally rotated.
    leftUpperLeg: [115, -45, 40],
    leftLowerLeg: [150, 0, 0],
    leftFoot: [17, 6, 16],
    rightUpperLeg: [115, -45, 40],
    rightLowerLeg: [135, 0, 0],
    rightFoot: [-30, -6, 35],
  },
};

export const POSE_KNEEL_ON_ONE_KNEE: PosePreset = {
  id: "kneel-on-one-knee",
  name: "Kneel on one knee",
  category: "kneeling",
  // Right knee and tucked toes on the floor, left foot flat in front, left palm on the knee.
  includesHands: true,
  tags: ["right-knee-down"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [2, 0, 0],
    neck: [5, 0, 0],
    leftUpperArm: [35, 15, 0],
    leftLowerArm: [34, 64, 0],
    leftHand: [5, 0, 0],
    rightUpperArm: [5, 0, 8],
    rightLowerArm: [15, 15, 0],
    leftUpperLeg: [93, 0, 5],
    leftLowerLeg: [84, 0, 0],
    leftFoot: [9, 0, 0],
    rightUpperLeg: [-4, 0, 3],
    rightLowerLeg: [109, 0, 0],
    rightFoot: [-26, 0, 0],
    rightToes: [-60, 0, 0],
  },
};

export const POSE_CROUCH: PosePreset = {
  id: "crouch",
  name: "Crouch",
  category: "kneeling",
  // Deep squat on the balls of the feet, elbows resting on the knees.
  hips: { orientation: [25, 0, 0] },
  includesHands: true,
  tags: ["low", "on-the-balls-of-the-feet"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [4, 0, 0],
    chest: [13, 0, 0],
    neck: [-30, 0, 0],
    head: [-15, 0, 0],
    leftUpperArm: [75, -4, -3],
    leftLowerArm: [34, 78, 0],
    rightUpperArm: [75, -4, -3],
    rightLowerArm: [34, 78, 0],
    leftUpperLeg: [120, -15, 20],
    leftLowerLeg: [155, 0, 0],
    leftFoot: [-29, 0, 0],
    leftToes: [-32, 0, 0],
    rightUpperLeg: [120, -15, 20],
    rightLowerLeg: [155, 0, 0],
    rightFoot: [-29, 0, 0],
    rightToes: [-32, 0, 0],
  },
};

export const POSE_LIE_ON_BACK: PosePreset = {
  id: "lie-on-back",
  name: "Lie on back",
  category: "lying",
  // Right knee up with the foot flat, right hand on the belly, left arm resting on the floor.
  hips: { orientation: [-90, 0, 0] },
  includesHands: true,
  tags: ["floor", "right-knee-up"],
  pose: {
    ...hands(HAND_RELAXED),
    neck: [-4, 10, 0],
    head: [5, 0, 0],
    leftUpperArm: [-14, -10, 47],
    leftLowerArm: [17, -27, 0],
    rightUpperArm: [7, 59, 21],
    rightLowerArm: [108, 31, 0],
    rightHand: [8, 0, 11],
    leftUpperLeg: [0, -15, 3],
    leftLowerLeg: [7, 0, 0],
    leftFoot: [20, 0, 0],
    rightUpperLeg: [44, 0, 3],
    rightLowerLeg: [97, 0, 0],
    rightFoot: [38, 0, 0],
  },
};

export const POSE_FIGHTING_STANCE: PosePreset = {
  id: "fighting-stance",
  name: "Fighting stance",
  category: "action",
  // Generic guard: lead foot flat, rear heel up, lead fist in front of the chin, rear fist by the jaw.
  hips: { orientation: [5, 0, 0] },
  includesHands: true,
  tags: ["guard", "left-foot-forward"],
  pose: {
    ...hands(HAND_FIST),
    spine: [3, -5, 0],
    chest: [3, -10, 0],
    neck: [8, 12, 0],
    head: [5, 3, 0],
    leftShoulder: [0, 5, 5],
    rightShoulder: [0, 0, 5],
    leftUpperArm: [51, -3, 14],
    leftLowerArm: [116, 40, 0],
    rightUpperArm: [44, 30, -9],
    rightLowerArm: [139, 30, 0],
    leftUpperLeg: [30, -15, 9],
    leftLowerLeg: [17, 0, 0],
    leftFoot: [12, 0, -3],
    rightUpperLeg: [-9, -35, 4],
    rightLowerLeg: [21, 0, 0],
    rightFoot: [-19, 0, 16],
    rightToes: [-1, 0, 0],
  },
};

export const POSE_TWO_HANDED_SWORD_STANCE: PosePreset = {
  id: "two-handed-sword-stance",
  name: "Two-handed sword stance",
  category: "action",
  // Generic middle guard: right foot forward, hands stacked on an imaginary handle at the navel.
  includesHands: true,
  tags: ["guard", "right-foot-forward", "holding"],
  pose: {
    ...hands(HAND_GRIP),
    leftUpperArm: [17, 42, 1],
    leftLowerArm: [70, 45, 0],
    leftHand: [0, 0, -10],
    rightUpperArm: [32, 25, -14],
    rightLowerArm: [54, 45, 0],
    rightHand: [0, 0, -10],
    leftUpperLeg: [-9, 0, 3],
    leftLowerLeg: [18, 0, 0],
    leftFoot: [-11, 0, 0],
    leftToes: [-29, 0, 0],
    rightUpperLeg: [12, 0, 3],
    rightLowerLeg: [9, 0, 0],
    rightFoot: [3, 0, 0],
  },
};

export const POSE_REACH_UP: PosePreset = {
  id: "reach-up",
  name: "Reach up",
  category: "action",
  // On tiptoes: the whole body leans slightly forward so the weight stays over the balls.
  hips: { orientation: [10, 0, 0] },
  includesHands: true,
  tags: ["on-tiptoes", "stretch"],
  pose: {
    ...hands(HAND_OPEN),
    spine: [-5, 0, 0],
    chest: [-5, 0, 0],
    neck: [-20, 0, 0],
    head: [-10, 0, 0],
    leftUpperArm: [133, -61, 72],
    leftLowerArm: [20, 0, 0],
    rightUpperArm: [170, -10, 22],
    rightLowerArm: [5, 0, 0],
    leftFoot: [10, 0, 0],
    leftToes: [-22, 0, 0],
    rightFoot: [11, 0, 0],
    rightToes: [-26, 0, 0],
  },
};

export const POSE_LOOK_BACK_OVER_SHOULDER: PosePreset = {
  id: "look-back-over-shoulder",
  name: "Look back over shoulder",
  category: "gesture",
  // The twist is spread over the legs, spine, chest, neck and head (looking over the left shoulder).
  hips: { orientation: [0, 0, 4] },
  includesHands: true,
  tags: ["twist", "looks-left"],
  pose: {
    ...hands(HAND_RELAXED),
    spine: [0, 12, 2],
    chest: [0, 25, 2],
    neck: [-5, 40, 5],
    head: [0, 20, 5],
    leftShoulder: [0, -10, 0],
    rightShoulder: [0, 10, 0],
    leftUpperArm: [-10, 0, 5],
    leftLowerArm: [15, 10, 0],
    rightUpperArm: [15, 5, 0],
    rightLowerArm: [20, 20, 0],
    leftUpperLeg: [8, 15, 5],
    leftLowerLeg: [15, 0, 0],
    leftFoot: [-7, 0, 0],
    rightUpperLeg: [0, -15, -4],
  },
};

export const POSE_HANDS_ON_HIPS: PosePreset = {
  id: "hands-on-hips",
  name: "Hands on hips",
  category: "gesture",
  hips: { orientation: [0, 0, -3] },
  includesHands: true,
  tags: ["confident", "weight-left"],
  pose: {
    ...hands(HAND_FLAT),
    chest: [-5, 0, 2],
    neck: [0, 5, -3],
    head: [-3, 0, -2],
    leftUpperArm: [-14, 62, 49],
    leftLowerArm: [114, 64, 0],
    leftHand: [10, 0, -16],
    rightUpperArm: [-13, 63, 47],
    rightLowerArm: [112, 64, 0],
    rightHand: [11, 0, -18],
    leftUpperLeg: [0, -5, 3],
    rightUpperLeg: [5, -5, 8],
    rightLowerLeg: [8, 0, 0],
    rightFoot: [-3, 0, 0],
  },
};

export const POSE_ARMS_CROSSED: PosePreset = {
  id: "arms-crossed",
  name: "Arms crossed",
  category: "gesture",
  // Right forearm against the body, left forearm folded in front of it.
  hips: { orientation: [0, 0, 3] },
  includesHands: true,
  tags: ["weight-right"],
  pose: {
    ...hands(HAND_RELAXED),
    chest: [-2, 0, -2],
    neck: [-3, 5, 2],
    leftUpperArm: [40, 80, -6],
    leftLowerArm: [84, 30, 0],
    rightUpperArm: [22, 80, 2],
    rightLowerArm: [85, 30, 0],
    leftUpperLeg: [6, 0, 3],
    leftLowerLeg: [12, 0, 0],
    leftFoot: [-6, 0, 0],
    rightUpperLeg: [0, -5, -3],
  },
};

export const POSE_THINKING: PosePreset = {
  id: "thinking",
  name: "Thinking (hand on chin)",
  category: "gesture",
  // Right knuckles under the chin; the left hand supports the right elbow.
  hips: { orientation: [0, 0, -3] },
  includesHands: true,
  tags: ["weight-left", "hand-on-chin"],
  pose: {
    ...hands(HAND_RELAXED, HAND_FIST),
    spine: [3, 0, 0],
    chest: [5, -5, 0],
    neck: [10, 0, -3],
    head: [5, 0, -5],
    leftUpperArm: [15, 69, 9],
    leftLowerArm: [91, 25, 0],
    rightUpperArm: [32, 55, -21],
    rightLowerArm: [140, 30, 0],
    leftUpperLeg: [0, -5, -2],
    rightUpperLeg: [8, -5, 4],
    rightLowerLeg: [12, 0, 0],
    rightFoot: [-4, 0, 0],
  },
};

export const POSE_PRESETS: readonly PosePreset[] = [
  POSE_RELAXED_STAND,
  POSE_T_POSE,
  POSE_A_POSE,
  POSE_CONTRAPPOSTO,
  POSE_WALK,
  POSE_RUN,
  POSE_JUMP,
  POSE_SIT_ON_CHAIR,
  POSE_SIT_CROSS_LEGGED,
  POSE_KNEEL_ON_ONE_KNEE,
  POSE_CROUCH,
  POSE_LIE_ON_BACK,
  POSE_FIGHTING_STANCE,
  POSE_TWO_HANDED_SWORD_STANCE,
  POSE_REACH_UP,
  POSE_LOOK_BACK_OVER_SHOULDER,
  POSE_HANDS_ON_HIPS,
  POSE_ARMS_CROSSED,
  POSE_THINKING,
];

/** Zero pose: arms hanging, palms toward the thighs, straight fingers ("Reset to neutral"). */
export const POSE_NEUTRAL: PosePreset = {
  id: "neutral",
  name: "Neutral",
  category: "standing",
  pose: {},
  includesHands: true,
  tags: ["reset"],
};

/** Default pose applied to new figures (PROJECT §7.1). */
export const DEFAULT_POSE_PRESET = POSE_RELAXED_STAND;

/** Every full-body preset the engine knows: the catalogue plus the neutral reset pose. */
export const ENGINE_POSE_PRESETS: readonly PosePreset[] = [...POSE_PRESETS, POSE_NEUTRAL];

/** UI labels and display order of the pose categories. */
export const POSE_CATEGORY_LABELS: Readonly<Record<PosePreset["category"], string>> = {
  standing: "Standing",
  locomotion: "Walk & run",
  sitting: "Sitting",
  kneeling: "Kneeling & crouching",
  lying: "Lying",
  action: "Action",
  gesture: "Gestures",
};
