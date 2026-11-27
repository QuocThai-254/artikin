// Procedural 2D artist mannequin — original artwork generated from a simple skeleton (forward
// kinematics) so the pose can be tweaked by numbers. Output: shaded SVG (gradients, ball joints,
// articulated fingers) plus a projected floor shadow. No external art or references are used.
import { HEX } from "./brand-lib.mjs";

// ---------- 2D vector helpers (screen space: x right, y down) ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const rad = (d) => (d * Math.PI) / 180;
/** Direction for an angle measured from straight down, positive toward screen-right. */
const dir = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const polar = (p, deg, l) => add(p, mul(dir(deg), l));
/** Rotate a vector counter-clockwise as seen on screen. */
const rotCCW = (v, deg) => {
  const c = Math.cos(rad(deg)),
    s = Math.sin(rad(deg));
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
};
const f = (n) => +n.toFixed(1);
const pt = (p) => `${f(p[0])} ${f(p[1])}`;

// ---------- shape builders ----------
/** Tapered capsule path between two circles (p1,r1) and (p2,r2). */
function capsule(p1, p2, r1, r2) {
  const d = sub(p2, p1),
    L = len(d);
  const u = mul(d, 1 / L),
    n = [-u[1], u[0]];
  const s = (r1 - r2) / L,
    c = Math.sqrt(Math.max(0, 1 - s * s));
  const side = (k) => add(mul(n, c * k), mul(u, s));
  const a1 = add(p1, mul(side(1), r1)),
    a2 = add(p2, mul(side(1), r2));
  const b2 = add(p2, mul(side(-1), r2)),
    b1 = add(p1, mul(side(-1), r1));
  return `M${pt(a1)}L${pt(a2)}A${f(r2)} ${f(r2)} 0 0 ${0} ${pt(b2)}L${pt(b1)}A${f(r1)} ${f(r1)} 0 1 ${0} ${pt(a1)}Z`;
}
/** Smooth closed path through points (Catmull-Rom → cubic Bézier). */
function blob(points) {
  const n = points.length;
  let d = `M${pt(points[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n],
      p1 = points[i],
      p2 = points[(i + 1) % n],
      p3 = points[(i + 2) % n];
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6)),
      c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + "Z";
}

// ---------- default figure (≈7.5 heads, height 1000 units, floor at y = 1000) ----------
export const BODY = {
  headH: 134,
  headW: 98,
  neckLen: 38,
  neckR: 21,
  chestH: 226,
  chestTopW: 196,
  chestBotW: 118,
  waistR: 39,
  pelvisH: 98,
  pelvisTopW: 164,
  pelvisBotW: 134,
  hipX: 58,
  hipR: 31,
  thighLen: 226,
  thighR: [44, 30],
  kneeR: 27,
  shinLen: 216,
  shinR: [31, 19],
  ankleR: 18,
  shoulderX: 104,
  shoulderR: 30,
  upperArmLen: 190,
  upperArmR: [28, 21],
  elbowR: 21,
  forearmLen: 162,
  forearmR: [20, 15],
  wristR: 14,
  handScale: 1,
  footScale: 1,
};

/** "Reaching for the light": weight on the image-left leg, image-left arm reaching up toward the bulb. */
export const REACH_POSE = {
  pelvisRot: -6,
  chestRot: 4,
  neckRot: 4,
  headRot: 14,
  lClavicle: 14,
  rClavicle: -2,
  lUpper: -148,
  lFore: -162,
  lHand: -166,
  lHandOpen: 1,
  rUpper: 30,
  rFore: -28,
  rHand: -14,
  rHandOpen: 0,
  rThumbBehind: true,
  lThigh: 4,
  lShin: 1,
  lFoot: -10,
  rThigh: 3,
  rShin: 15,
  rFoot: 20,
};

/** Neutral "relaxed stand" (arms slightly away from the body), used for proportion lineups. */
export const STAND_POSE = {
  pelvisRot: 0,
  chestRot: 0,
  neckRot: 0,
  headRot: 0,
  lClavicle: 0,
  rClavicle: 0,
  lUpper: -6,
  lFore: -3,
  lHand: -1,
  lHandOpen: 0.05,
  rUpper: 6,
  rFore: 3,
  rHand: 1,
  rHandOpen: 0.05,
  lThigh: 1.5,
  lShin: 0,
  lFoot: -12,
  rThigh: -1.5,
  rShin: 0,
  rFoot: 12,
};

/**
 * Derive body dimensions for a preset from its height (m) and "heads tall" (PROJECT §8.1).
 * Lengths below the head scale together; `build` scales limb/torso widths (slim < 1 < muscular)
 * and `shoulders` scales the shoulder span.
 */
export function bodyFor({
  heightM = 1.83,
  heads = 7.5,
  build = 1,
  shoulders = 1,
  refHeightM = 1.83,
} = {}) {
  const H = 1007 * (heightM / refHeightM);
  const headH = H / heads;
  const s = (H - headH) / (1007 - BODY.headH);
  const w = s * build;
  const out = {};
  for (const [k, v] of Object.entries(BODY)) {
    const isWidth = /R$|W$|X$|Rs?$/.test(k) || k.endsWith("R");
    out[k] = Array.isArray(v) ? v.map((x) => x * w) : isWidth ? v * w : v * s;
  }
  out.headH = headH;
  out.headW = headH * (BODY.headW / BODY.headH);
  out.shoulderX = BODY.shoulderX * w * shoulders;
  out.chestTopW = BODY.chestTopW * w * shoulders;
  out.hipX = BODY.hipX * w;
  out.handScale = s * (0.92 + 0.08 * build);
  out.footScale = s;
  return out;
}

/**
 * Build the mannequin.
 * @param {object} o
 * @param {"wood"|"toon"} [o.material] wood = soft gradients; toon = hard cel steps + ink outline
 * @returns {{ body: string, defs: string, bounds: number[], anchors: object }}
 */
export function buildMannequin({
  pose = REACH_POSE,
  body: B = BODY,
  light = [-0.62, -0.78],
  id = "mq",
  material = "wood",
  rim = true,
} = {}) {
  const L = norm(light);
  const defs = [];
  const parts = []; // { z, svg }
  let gid = 0;
  const toon = material === "toon";

  const wood = toon
    ? { light: "#F4DEC4", mid: "#F4DEC4", shadow: "#C99A74", deep: "#C99A74" }
    : { light: HEX.woodLight, mid: HEX.wood, shadow: HEX.woodShadow, deep: HEX.woodDeep };
  const seam = toon
    ? `stroke="#24180F" stroke-width="${f(Math.max(3, B.headH * 0.03))}" stroke-linejoin="round"`
    : `stroke="${HEX.woodDeep}" stroke-opacity=".55" stroke-width="1.6"`;

  /** Gradient across a limb (perpendicular to its axis), bright on the side facing the light. */
  function limbGradient(p1, p2, r) {
    const u = norm(sub(p2, p1));
    let n = [-u[1], u[0]];
    const facing = dot(n, L);
    if (facing < 0) n = mul(n, -1);
    const k = Math.abs(facing); // 0 → limb points at the light (flat), 1 → side-lit (strong)
    const m = mul(add(p1, p2), 0.5);
    const a = add(m, mul(n, -r)),
      b = add(m, mul(n, r));
    const gidS = `${id}g${gid++}`;
    const term = 0.36 + (1 - k) * 0.18;
    defs.push(
      toon
        ? `<linearGradient id="${gidS}" gradientUnits="userSpaceOnUse" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"><stop offset="${f(term)}" stop-color="${wood.shadow}"/><stop offset="${f(term)}" stop-color="${wood.light}"/></linearGradient>`
        : `<linearGradient id="${gidS}" gradientUnits="userSpaceOnUse" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}">
<stop offset="0" stop-color="${wood.shadow}"/><stop offset=".1" stop-color="${wood.deep}"/><stop offset="${f(term - 0.08)}" stop-color="${wood.shadow}"/>
<stop offset="${f(term + 0.06)}" stop-color="${wood.mid}"/><stop offset=".78" stop-color="${wood.light}"/><stop offset="1" stop-color="${wood.light}"/></linearGradient>`,
    );
    return `url(#${gidS})`;
  }
  /** Sphere-like radial gradient with the highlight shifted toward the light. */
  function ballGradient(c, r) {
    const gidS = `${id}g${gid++}`;
    const fx = c[0] + L[0] * r * 0.45,
      fy = c[1] + L[1] * r * 0.45;
    defs.push(
      toon
        ? `<radialGradient id="${gidS}" gradientUnits="userSpaceOnUse" cx="${f(c[0] + L[0] * r * 0.35)}" cy="${f(c[1] + L[1] * r * 0.35)}" r="${f(r * 1.3)}"><stop offset=".72" stop-color="${wood.light}"/><stop offset=".72" stop-color="${wood.shadow}"/></radialGradient>`
        : `<radialGradient id="${gidS}" gradientUnits="userSpaceOnUse" cx="${f(c[0] + L[0] * r * 0.2)}" cy="${f(c[1] + L[1] * r * 0.2)}" r="${f(r * 1.25)}" fx="${f(fx)}" fy="${f(fy)}">
<stop offset="0" stop-color="${wood.light}"/><stop offset=".45" stop-color="${wood.mid}"/><stop offset=".8" stop-color="${wood.shadow}"/><stop offset="1" stop-color="${wood.deep}"/></radialGradient>`,
    );
    return `url(#${gidS})`;
  }
  const push = (z, svg) => parts.push({ z, svg });
  const limb = (z, p1, p2, r1, r2) =>
    push(
      z,
      `<path d="${capsule(p1, p2, r1, r2)}" fill="${limbGradient(p1, p2, Math.max(r1, r2))}" ${seam}/>`,
    );
  const ball = (z, c, r) =>
    push(
      z,
      `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(r)}" fill="${ballGradient(c, r)}" ${seam}/>`,
    );

  // ----- torso chain (root = pelvis center) -----
  const root = [0, 505];
  const pelvisUp = rotCCW([0, -1], pose.pelvisRot);
  const pelvisRight = rotCCW([1, 0], pose.pelvisRot);
  const hipL = add(add(root, mul(pelvisRight, -B.hipX)), mul(pelvisUp, -B.pelvisH * 0.18));
  const hipR = add(add(root, mul(pelvisRight, B.hipX)), mul(pelvisUp, -B.pelvisH * 0.18));
  const waist = add(
    root,
    mul(rotCCW([0, -1], (pose.pelvisRot + pose.chestRot) / 2), B.pelvisH * 0.94),
  );
  const chestUp = rotCCW([0, -1], pose.chestRot);
  const chestRight = rotCCW([1, 0], pose.chestRot);
  const chestBase = add(waist, mul(chestUp, B.waistR * 0.77));
  const neckBase = add(chestBase, mul(chestUp, B.chestH * 0.938));
  const shoulderL = add(
    add(neckBase, mul(chestRight, -B.shoulderX)),
    mul(chestUp, -B.chestH * 0.097 + pose.lClavicle),
  );
  const shoulderR = add(
    add(neckBase, mul(chestRight, B.shoulderX)),
    mul(chestUp, -B.chestH * 0.097 + pose.rClavicle),
  );
  const neckUp = rotCCW([0, -1], pose.chestRot + pose.neckRot);
  const neckTop = add(neckBase, mul(neckUp, B.neckLen));
  const headUp = rotCCW([0, -1], pose.chestRot + pose.neckRot + pose.headRot);
  const headC = add(neckTop, mul(headUp, B.headH * 0.47));

  // pelvis block (rounded "brief" shape; hip balls show at the sides)
  {
    const T = B.pelvisTopW / 2,
      Bt = B.pelvisBotW / 2,
      H = B.pelvisH;
    const pts = [
      [-T * 0.9, -H * 0.46],
      [0, -H * 0.56],
      [T * 0.9, -H * 0.46],
      [T * 1.02, -H * 0.16],
      [Bt * 0.96, H * 0.1],
      [Bt * 0.45, H * 0.38],
      [0, H * 0.46],
      [-Bt * 0.45, H * 0.38],
      [-Bt * 0.96, H * 0.1],
      [-T * 1.02, -H * 0.16],
    ].map((p) => add(root, rotCCW(p, pose.pelvisRot)));
    push(
      30,
      `<path d="${blob(pts)}" fill="${ballGradient(add(root, [0, -20]), T * 1.1)}" ${seam}/>`,
    );
  }
  // waist ball + chest block
  ball(31, waist, B.waistR);
  {
    // Ribcage: broad at the shoulders, tapering to a rounded bottom above the waist ball.
    const W1 = B.chestTopW / 2,
      W0 = B.chestBotW / 2,
      H = B.chestH;
    const local = [
      [0, 12],
      [W0 * 0.75, 4],
      [W0 * 1.12, -H * 0.2],
      [W1 * 0.98, -H * 0.62],
      [W1 * 0.86, -H * 0.9],
      [W1 * 0.42, -H * 1.0],
      [-W1 * 0.42, -H * 1.0],
      [-W1 * 0.86, -H * 0.9],
      [-W1 * 0.98, -H * 0.62],
      [-W0 * 1.12, -H * 0.2],
      [-W0 * 0.75, 4],
    ];
    const pts = local.map((p) => add(chestBase, rotCCW(p, pose.chestRot)));
    const c = add(chestBase, mul(chestUp, H * 0.62));
    push(
      32,
      `<path d="${blob(pts)}" fill="${ballGradient(add(c, mul(L, 30)), W1 * 1.05)}" ${seam}/>`,
    );
  }
  // neck + head (faceless egg)
  limb(
    33,
    add(neckBase, mul(neckUp, -B.neckLen * 0.42)),
    add(neckTop, mul(neckUp, B.neckLen * 0.21)),
    B.neckR,
    B.neckR * 0.92,
  );
  {
    const a = pose.chestRot + pose.neckRot + pose.headRot;
    const egg = [];
    for (let i = 0; i < 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      const taper = 1 - (0.26 * (1 - Math.cos(t))) / 2; // 1 at the crown, 0.74 at the chin
      egg.push(
        add(headC, rotCCW([(B.headW / 2) * Math.sin(t) * taper, -(B.headH / 2) * Math.cos(t)], a)),
      );
    }
    push(
      34,
      `<path d="M${egg.map(pt).join("L")}Z" fill="${ballGradient(headC, B.headW * 0.62)}" ${seam}/>`,
    );
  }

  // ----- arms -----
  function arm(side, shoulder, upperA, foreA, handA, open, zBase, thumbBehind = false) {
    const elbow = polar(shoulder, upperA, B.upperArmLen);
    const wrist = polar(elbow, foreA, B.forearmLen);
    ball(zBase, shoulder, B.shoulderR);
    limb(zBase + 1, shoulder, elbow, B.upperArmR[0], B.upperArmR[1]);
    limb(zBase + 1, elbow, wrist, B.forearmR[0], B.forearmR[1]);
    ball(zBase + 2, elbow, B.elbowR);
    hand(zBase + 3, wrist, handA, side, open, thumbBehind);
    ball(zBase + 4, wrist, B.wristR);
    return { elbow, wrist };
  }

  /**
   * Hand with a palm block, four 3-phalanx fingers and a 2-phalanx thumb.
   * `thumbSign` places the thumb on the left (−1) or right (+1) of the pointing direction.
   */
  function hand(z, wrist, a, thumbSign, open, thumbBehind = false) {
    const u = dir(a),
      n = [-u[1], u[0]];
    const hs = B.handScale ?? 1;
    const palmLen = 50 * hs,
      wBase = 30 * hs,
      wKnuck = 42 * hs;
    const knuck = polar(wrist, a, palmLen);
    const palmPts = [
      add(wrist, mul(n, wBase / 2)),
      add(add(wrist, mul(u, palmLen * 0.55)), mul(n, wKnuck / 2 + 1)),
      add(knuck, mul(n, wKnuck / 2)),
      add(knuck, mul(n, -wKnuck / 2)),
      add(add(wrist, mul(u, palmLen * 0.55)), mul(n, -wKnuck / 2 - 1)),
      add(wrist, mul(n, -wBase / 2)),
    ];
    const fingers = [
      { off: 0.37, len: 44 * hs, r: 6.4 * hs, spread: -11 },
      { off: 0.12, len: 49 * hs, r: 6.6 * hs, spread: -3 },
      { off: -0.13, len: 46 * hs, r: 6.3 * hs, spread: 5 },
      { off: -0.37, len: 37 * hs, r: 5.6 * hs, spread: 13 },
    ];
    const segs = [0.46, 0.3, 0.24];
    const curl = (1 - open) * 22; // degrees per joint, bending toward the thumb-less side in 2D
    for (const fg of fingers) {
      const side = thumbSign; // index finger nearest the thumb
      let p = add(knuck, mul(n, fg.off * wKnuck * side));
      let ang = a + fg.spread * open * side;
      let r = fg.r;
      segs.forEach((k, i) => {
        const q = polar(
          p,
          ang + (i ? curl * side * 0.15 : 0),
          fg.len * k * (1 - (1 - open) * 0.35),
        );
        limb(z, p, q, r, r * 0.9);
        p = q;
        r *= 0.9;
        ang += curl * 0.2 * side;
      });
    }
    // thumb from the palm side near the wrist
    const tBase = add(add(wrist, mul(u, palmLen * 0.28)), mul(n, (wBase / 2) * thumbSign));
    const tA = a - thumbSign * (38 + 18 * open);
    const t1 = polar(tBase, tA, 26 * hs),
      t2 = polar(t1, tA + thumbSign * 12 * open, 20 * hs);
    push(
      z,
      `<path d="${blob(palmPts)}" fill="${limbGradient(wrist, knuck, wKnuck / 2)}" ${seam}/>`,
    );
    if (!thumbBehind) {
      limb(z + 0.1, tBase, t1, 8.2 * hs, 7.4 * hs);
      limb(z + 0.1, t1, t2, 7.4 * hs, 6.4 * hs);
    }
  }

  const lArm = arm(1, shoulderL, pose.lUpper, pose.lFore, pose.lHand, pose.lHandOpen, 40);
  const rArm = arm(
    -1,
    shoulderR,
    pose.rUpper,
    pose.rFore,
    pose.rHand,
    pose.rHandOpen,
    36,
    pose.rThumbBehind,
  );

  // ----- legs -----
  function leg(hip, thighA, shinA, footA, zBase) {
    const knee = polar(hip, thighA, B.thighLen);
    const ankle = polar(knee, shinA, B.shinLen);
    limb(zBase, hip, knee, B.thighR[0], B.thighR[1]);
    limb(zBase, knee, ankle, B.shinR[0], B.shinR[1]);
    ball(zBase + 1, knee, B.kneeR);
    // front-view foot: a rounded wedge flaring toward the toes, plus a toe block
    const u = dir(footA),
      n = [-u[1], u[0]];
    const fs = B.footScale ?? 1;
    const heel = add(ankle, mul(u, 6 * fs));
    const toe = add(ankle, mul(u, 46 * fs));
    const footPts = [
      add(heel, mul(n, 17 * fs)),
      add(toe, mul(n, 27 * fs)),
      add(add(toe, mul(u, 8 * fs)), mul(n, 10 * fs)),
      add(add(toe, mul(u, 8 * fs)), mul(n, -10 * fs)),
      add(toe, mul(n, -27 * fs)),
      add(heel, mul(n, -17 * fs)),
    ];
    push(
      zBase - 1,
      `<path d="${blob(footPts)}" fill="${limbGradient(heel, toe, 26 * fs)}" ${seam}/>`,
    );
    ball(zBase + 1, ankle, B.ankleR);
    ball(zBase + 1, hip, B.hipR);
    return { knee, ankle, sole: add(toe, mul(u, 10 * fs)) };
  }
  const lLeg = leg(hipL, pose.lThigh, pose.lShin, pose.lFoot, 10);
  const rLeg = leg(hipR, pose.rThigh, pose.rShin, pose.rFoot, 12);

  // ground the figure: lowest sole touches y = 1000
  const lowest = Math.max(lLeg.sole[1], rLeg.sole[1]);
  const dy = 1000 - lowest;

  parts.sort((a, b) => a.z - b.z);
  // Cool rim light on the figure's right edges (opposite the warm key light) to separate it from
  // the dark background: the alpha shifted left, subtracted from itself, tinted and merged on top.
  if (rim)
    defs.push(`<filter id="${id}-rim" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
<feOffset in="SourceAlpha" dx="-5" dy="0" result="off"/><feComposite in="SourceAlpha" in2="off" operator="out" result="edge"/>
<feGaussianBlur in="edge" stdDeviation="1.1" result="soft"/><feFlood flood-color="#E4E8F5" flood-opacity=".36"/>
<feComposite in2="soft" operator="in" result="rim"/><feComposite in="rim" in2="SourceAlpha" operator="in" result="rimIn"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="rimIn"/></feMerge></filter>`);
  const bodySvg = `<g transform="translate(0 ${f(dy)})"${rim ? ` filter="url(#${id}-rim)"` : ""}>${parts.map((p) => p.svg).join("")}</g>`;
  // Black silhouette of the same shapes (for filter-free cast shadows).
  const silhouette = `<g transform="translate(0 ${f(dy)})">${parts.map((p) => p.svg.replace(/fill="url\(#[^)]+\)"/g, 'fill="#000"').replace(/ stroke(?:-[a-z]+)?="[^"]*"/g, "")).join("")}</g>`;

  const pts = [headC, lArm.wrist, rArm.elbow, lLeg.sole, rLeg.sole, shoulderL, shoulderR].map((p) =>
    add(p, [0, dy]),
  );
  const anchors = {
    head: add(headC, [0, dy]),
    leftHand: add(polar(lArm.wrist, pose.lHand, 70), [0, dy]),
    leftElbow: add(lArm.elbow, [0, dy]),
    leftShoulder: add(shoulderL, [0, dy]),
    rightElbow: add(rArm.elbow, [0, dy]),
    pelvis: add(root, [0, dy]),
    feet: [add(lLeg.sole, [0, dy]), add(rLeg.sole, [0, dy])],
  };
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return {
    defs: defs.join(""),
    body: bodySvg,
    silhouette,
    parts: parts.map((p) => p.svg).join(""),
    dy,
    bounds: [Math.min(...xs) - 80, Math.min(...ys) - 120, Math.max(...xs) + 80, 1000],
    anchors,
  };
}

/**
 * Floor shadow: the figure silhouette projected onto the floor (sheared away from the light),
 * plus contact shadows under the feet.
 */
export function floorShadow({
  figureId,
  shear = 0.95,
  squash = 0.16,
  baseline = 1000,
  contact = [],
  opacity = 0.5,
  blur = 5,
  soft = true,
  silhouette = "",
}) {
  const m = `matrix(1 0 ${-shear} ${squash} ${f(shear * baseline)} ${f((1 - squash) * baseline)})`;
  if (!soft) {
    // Filter-free variant for the web: SVG filters are costly to rasterize on the main thread, so
    // the cast shadow is the figure's black silhouette (plain paths) and contact shadows are gradients.
    return {
      defs: `<radialGradient id="${figureId}-contact"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`,
      svg: `<g opacity="${opacity}" transform="${m}">${silhouette}</g>
${contact.map(([x, y, rx]) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx * 1.3)}" ry="${f(rx * 0.3)}" fill="url(#${figureId}-contact)"/>`).join("")}`,
    };
  }
  return {
    defs: `<filter id="${figureId}-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter>
<filter id="${figureId}-sil"><feFlood flood-color="#000"/><feComposite in2="SourceAlpha" operator="in"/></filter>`,
    svg: `<g opacity="${opacity}" filter="url(#${figureId}-blur)"><g transform="${m}" filter="url(#${figureId}-sil)"><use href="#${figureId}"/></g></g>
${contact.map(([x, y, rx]) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(rx * 0.22)}" fill="#000" opacity=".55" filter="url(#${figureId}-blur)"/>`).join("")}`,
  };
}
