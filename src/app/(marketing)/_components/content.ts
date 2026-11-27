// Landing copy (English), kept in one module so a Vietnamese locale can be added later.
// Numbers that are product settings (the workspace quota) are passed in, never hard-coded.

export const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
] as const;

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
/** "five" for 5, digits above ten. */
export const spelled = (n: number) => WORDS[n] ?? String(n);

export const HERO = {
  words: ["Pose", "Light", "Draw"],
  lead: "Artikin is a free 3D artist mannequin in your browser: bend realistic joints down to every finger, light the figure with dimmable bulbs and lock the pose to draw it from any angle.",
  note: "No install. No account needed to start.",
  imageAlt:
    "A faceless wooden artist mannequin on a studio floor, reaching up toward a glowing light bulb that casts its shadow across the floor.",
  plate: {
    shoulder: { label: "Shoulder abduction", value: "148°", range: "of 180° max" },
    light: { label: "Key light", value: "70%", detail: "4500 K" },
    lock: { label: "Pose, lights & view locked", short: "All locked", key: "L" },
    heads: "7½ heads",
    caption: "Classic Wooden, reaching toward the light",
  },
} as const;

export const CTA = {
  editor: "Open editor",
  signUp: "Sign up free",
  workspaces: "My workspaces",
} as const;

export const features = (limit: number) =>
  ({
    title: "Everything the wooden one can't do",
    lead: "Real joints, real light and a lock that holds — in a tab right next to your canvas.",
    joints: {
      title: "Realistic joints, down to the fingers",
      body: "51 bones with anatomical ranges of motion — neck, spine, shoulders, elbows, wrists, hips, knees, ankles and every finger joint. Push past a limit and the joint simply stops.",
      caption: "Range of motion in degrees, from the neutral standing pose",
    },
    drag: {
      title: "Drag to pose",
      body: "Click a body part to rotate it, or grab a hand or foot and drag — the whole limb follows. Sliders take care of the fine-tuning.",
    },
    orbit: {
      title: "360° orbit",
      body: "Circle the figure without limits, zoom into a hand, snap to front, side or top views and set a lens from 18 to 200 mm.",
    },
    light: {
      title: "Light bulbs and real shadows",
      body: "Place up to four bulbs, drag them anywhere and dim them from 0 to 100%. Warm them toward candlelight or cool them toward daylight, and watch shadows fall across the body and the floor.",
    },
    lock: {
      title: "Lock pose, lights and view",
      body: "Orbit to your angle and press L — pose, lights and view hold still while you draw. Press V to look around without touching the pose or the lights.",
    },
    presets: {
      title: "Anime age and build presets",
      body: "Go from a 5½-head child to a 7½-head young adult or a compact, muscular build, then switch to cel-shaded toon material for a manga look.",
      caption: "Body presets drawn to scale. Toon material on the anime presets.",
    },
    workspaces: {
      title: `Up to ${limit} saved workspaces`,
      body: `Create a free account to keep up to ${spelled(limit)} scenes in the cloud. Autosave keeps your latest pose safe.`,
      caption: "Example workspaces",
    },
  }) as const;

export const STEPS = {
  title: "Three steps to a drawing reference",
  items: [
    {
      title: "Pose",
      body: "Pick a body type, then rotate joints or drag hands and feet into place. Pose presets get you started.",
      reading: { label: "Shoulder", value: "148°" },
    },
    {
      title: "Light",
      body: "Add a bulb, move it around the figure and dim it until the shadows read right.",
      reading: { label: "Key light", value: "70% · 4500 K" },
    },
    {
      title: "Lock & draw",
      body: "Orbit to your angle and lock it all — pose, lights and view — then draw. Export a clean PNG reference when you need one.",
      // `short` replaces the label where three steps share a row on narrow screens (md).
      reading: { label: "Pose, lights & view", short: "All", value: "locked · L" },
    },
  ],
} as const;

export const faq = (limit: number) =>
  ({
    title: "Questions, answered",
    items: [
      {
        q: "Is Artikin free?",
        a: `Yes. The editor is free to use, and a free account saves up to ${spelled(limit)} workspaces in the cloud.`,
      },
      {
        q: "Do I need an account?",
        a: "No. Open the editor and start posing right away — your scene is kept as a draft in this browser. Create an account when you want to save workspaces and open them on any device.",
      },
      {
        q: "Which browsers does it support?",
        a: "Current desktop versions of Chrome and other Chromium-based browsers, Firefox and Safari, with WebGL 2. Posing is designed for a mouse on a desktop or laptop; tablets work too, and phones are best for viewing.",
      },
      {
        q: "Can I use it for anime and manga characters?",
        a: "Yes. Start from the anime age and build presets and the cel-shaded toon material, then pose your own characters. Every figure and preset in Artikin is original and generic — none is based on an existing character.",
      },
    ],
  }) as const;

export const CLOSING = {
  title: "Your mannequin is ready.",
  body: "Open the editor and make your first pose in under a minute — no install, no sign-up.",
} as const;
