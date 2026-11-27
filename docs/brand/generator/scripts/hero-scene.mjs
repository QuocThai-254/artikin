// Hero scene: the procedural mannequin in a dark "viewport" with a glowing bulb, a perspective floor
// grid, a warm light pool, a projected cast shadow and a joint-rotation ring. Original artwork.
import { buildMannequin, floorShadow } from "./mannequin.mjs";
import { HEX } from "./brand-lib.mjs";

const f = (n) => +n.toFixed(1);

export const BULB = [-405, -350];

/**
 * @param {object} o
 * @param {number[]} [o.viewBox] [x, y, w, h] in figure units (figure height 1000, floor y = 1000)
 * @param {boolean} [o.gizmo] draw the rotation ring around the raised elbow
 * @param {boolean} [o.background] paint the viewport background (false → transparent, e.g. OG composition)
 * @param {string} [o.id] unique id prefix
 */
export function heroScene({
  viewBox = [-560, -520, 1120, 1680],
  gizmo = true,
  background = true,
  grid = true,
  glow = true,
  filters = true,
  id = "hero",
} = {}) {
  const [vx, vy, vw, vh] = viewBox;
  // `filters: false` → no SVG filters (cheap to rasterize in browsers); `true` → soft shadows + rim light.
  const m = buildMannequin({ id: `${id}m`, rim: filters });
  const shadow = floorShadow({
    figureId: `${id}fig`,
    shear: 0.42,
    squash: 0.2,
    blur: 4,
    opacity: filters ? 0.55 : 0.38,
    soft: filters,
    silhouette: m.silhouette,
    contact: m.anchors.feet.map((p) => [p[0], 1000, 48]),
  });
  const [bx, by] = BULB;
  const horizon = 690;

  // Perspective grid on the floor plane, fading toward the horizon.
  let gridSvg = "";
  if (grid) {
    const vp = [0, horizon - 260];
    const lines = [];
    for (let i = -14; i <= 14; i++) {
      const x0 = i * 150;
      const bottom = vy + vh;
      // line from the vanishing point through (x0, 1000) to the bottom edge
      const t = (bottom - vp[1]) / (1000 - vp[1]);
      lines.push(
        `M${f(vp[0] + (x0 - vp[0]) * ((horizon - vp[1]) / (1000 - vp[1])))} ${horizon}L${f(vp[0] + (x0 - vp[0]) * t)} ${f(bottom)}`,
      );
    }
    for (let k = 0; k < 18; k++) {
      // rows equally spaced in depth → closer together near the horizon
      const z = 1 / (1 + k * 0.42);
      const y = horizon + (vy + vh - horizon) * z;
      if (y > horizon + 4 && y < vy + vh) lines.push(`M${vx} ${f(y)}L${vx + vw} ${f(y)}`);
    }
    gridSvg = `<path d="${lines.join("")}" stroke="#FFFFFF" stroke-opacity=".07" stroke-width="2" fill="none" mask="url(#${id}floorFade)"/>`;
  }

  // Joint ring around the raised elbow, perpendicular to the forearm.
  let gizmoSvg = "";
  if (gizmo) {
    const e = m.anchors.leftElbow;
    const s = m.anchors.leftShoulder;
    const ang = (Math.atan2(e[1] - s[1], e[0] - s[0]) * 180) / Math.PI;
    gizmoSvg = `<g transform="translate(${f(e[0])} ${f(e[1])}) rotate(${f(ang)})" fill="none">
<ellipse rx="30" ry="74" stroke="${HEX.amber}" stroke-width="5" opacity=".95"/>
<ellipse rx="30" ry="74" stroke="${HEX.amber}" stroke-width="16" opacity=".14"/>
<circle cx="-28" cy="-26" r="9" fill="${HEX.amber}" stroke="#141417" stroke-width="3"/></g>`;
  }

  const defs = `${m.defs}${shadow.defs}
<linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B1B1C"/><stop offset=".55" stop-color="#141415"/><stop offset="1" stop-color="#0E0E0F"/></linearGradient>
<radialGradient id="${id}glow" cx="${bx}" cy="${by}" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${HEX.amber}" stop-opacity=".36"/><stop offset=".25" stop-color="${HEX.amber}" stop-opacity=".13"/><stop offset=".6" stop-color="${HEX.amber}" stop-opacity=".03"/><stop offset="1" stop-color="${HEX.amber}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}pool" cx="-150" cy="1010" r="560" gradientTransform="translate(0 ${f(1010 * 0.72)}) scale(1 .28)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${HEX.amber}" stop-opacity=".16"/><stop offset="1" stop-color="${HEX.amber}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}floor" x1="0" y1="${horizon}" x2="0" y2="${vy + vh}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".35" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>
<linearGradient id="${id}fadeG" x1="0" y1="${horizon}" x2="0" y2="${vy + vh}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff"/></linearGradient>
<mask id="${id}floorFade" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vh}"><rect x="${vx}" y="${horizon}" width="${vw}" height="${vh}" fill="url(#${id}fadeG)"/></mask>
<radialGradient id="${id}bulb" cx="${bx - 9}" cy="${by - 10}" r="44" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".35" stop-color="#FFF1D2"/><stop offset=".75" stop-color="${HEX.amber}"/><stop offset="1" stop-color="#E08F1B"/></radialGradient>
<radialGradient id="${id}halo" cx="${bx}" cy="${by}" r="120" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFE7B8" stop-opacity=".9"/><stop offset=".3" stop-color="${HEX.amber}" stop-opacity=".35"/><stop offset="1" stop-color="${HEX.amber}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}vig" cx="0" cy="${vy + vh * 0.45}" r="${vw}" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
<g id="${id}fig">${m.body}</g>`;

  const bg = background
    ? `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#${id}bg)"/>
<rect x="${vx}" y="${horizon}" width="${vw}" height="${vy + vh - horizon}" fill="url(#${id}floor)"/>`
    : "";
  const body = `${bg}
<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#${id}glow)"${glow ? "" : ' display="none"'}/>
${gridSvg}
<ellipse cx="-150" cy="1010" rx="560" ry="157" fill="url(#${id}pool)"/>
${shadow.svg}
<use href="#${id}fig"/>
${gizmoSvg}
<circle cx="${bx}" cy="${by}" r="120" fill="url(#${id}halo)"/>
<rect x="${bx - 13}" y="${by - 58}" width="26" height="20" rx="5" fill="#3A3A40"/>
<circle cx="${bx}" cy="${by}" r="34" fill="url(#${id}bulb)"/>
${background ? `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#${id}vig)"/>` : ""}`;

  return { defs, body, anchors: m.anchors, viewBox };
}

export function heroSceneSvg(opts = {}) {
  const s = heroScene(opts);
  const [vx, vy, vw, vh] = s.viewBox;
  const title =
    opts.title ??
    "Illustration: a faceless wooden artist mannequin reaching toward a glowing light bulb, casting a shadow on the floor";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="${title}"><title>${title}</title><defs>${s.defs}</defs>${s.body}</svg>`;
}
