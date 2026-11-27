// Open Graph image (1200×630) as an HTML composition rasterized by Chromium: lockup, the
// "Pose. Light. Draw." stack in the display face with amber ball full stops, and the mannequin plate.
import { heroScene, BULB } from "./hero-scene.mjs";
import { HEX, lockupSvg } from "./brand-lib.mjs";

const f = (n) => +n.toFixed(2);

/** Shoulder range-of-motion protractor (0–180°, current 148°) in figure units. */
function protractor([sx, sy], R = 190, arm = -148) {
  const at = (deg, r = R) => [
    sx + r * Math.sin((deg * Math.PI) / 180),
    sy + r * Math.cos((deg * Math.PI) / 180),
  ];
  const p = (q) => `${f(q[0])} ${f(q[1])}`;
  const ticks = Array.from({ length: 13 }, (_, i) => -i * 15)
    .map(
      (d) =>
        `<path d="M${p(at(d, R - (d % 30 ? 8 : 14)))}L${p(at(d, R + (d % 30 ? 8 : 14)))}" stroke="#fff" stroke-opacity="${d % 30 ? 0.28 : 0.5}" stroke-width="3"/>`,
    )
    .join("");
  return `<g fill="none">
<path d="M${p(at(0))}A${R} ${R} 0 0 1 ${p(at(-90))}A${R} ${R} 0 0 1 ${p(at(-180))}" stroke="#fff" stroke-opacity=".22" stroke-width="5"/>${ticks}
<path d="M${p(at(0))}A${R} ${R} 0 0 1 ${p(at(-90))}A${R} ${R} 0 0 1 ${p(at(arm))}" stroke="${HEX.amber}" stroke-width="12" stroke-linecap="round"/>
<path d="M${p(at(arm, 34))}L${p(at(arm, R + 34))}" stroke="${HEX.amber}" stroke-opacity=".75" stroke-width="3" stroke-dasharray="10 10"/>
<circle cx="${f(at(arm)[0])}" cy="${f(at(arm)[1])}" r="14" fill="${HEX.amber}" stroke="#141418" stroke-width="7"/></g>`;
}

export function ogHtml() {
  const W = 1200,
    H = 630;
  // Figure units → OG pixels: figure x = 0 maps to px 905, floor (y = 1000) to px 590.
  const k = 0.4,
    fx = 905,
    floorY = 590;
  const vb = [-fx / k, 1000 - floorY / k, W / k, H / k];
  const scene = heroScene({ viewBox: vb, gizmo: false, background: false, glow: false, id: "og" });
  const bulbPx = [fx + BULB[0] * k, floorY + (BULB[1] - 1000) * k];
  const dot = `<span class="dot" aria-hidden="true"></span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;background:linear-gradient(180deg,#161616,${HEX.background});font-family:Geist,sans-serif;color:${HEX.foreground}}
.glow{position:absolute;left:${f(bulbPx[0] - 520)}px;top:${f(bulbPx[1] - 520)}px;width:1040px;height:1040px;border-radius:50%;
 background:radial-gradient(closest-side,color-mix(in srgb,${HEX.amber} 34%,transparent),color-mix(in srgb,${HEX.amber} 12%,transparent) 30%,color-mix(in srgb,${HEX.amber} 3%,transparent) 70%,transparent)}
svg.scene{position:absolute;inset:0;width:${W}px;height:${H}px}
.floor{position:absolute;left:0;right:0;top:${floorY - 150}px;bottom:0;background:linear-gradient(180deg,transparent,rgb(0 0 0/.35))}
.scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgb(10 10 10/.6),rgb(10 10 10/.25) 45%,transparent 62%)}
.copy{position:absolute;left:72px;top:58px}
.lockup{height:50px;display:block}
h1{margin:64px 0 0;font-family:Archivo,Geist,sans-serif;font-stretch:118%;font-weight:640;font-size:92px;line-height:.94;letter-spacing:-.025em}
h1 span{display:block}
.dot{display:inline-block;width:.17em;height:.17em;margin-left:.05em;border-radius:50%;background:${HEX.amber}}
p{margin:30px 0 0;font-size:30px;color:${HEX.mutedForeground}}
</style></head><body>
<div class="glow"></div>
<svg class="scene" viewBox="${vb.map(f).join(" ")}" xmlns="http://www.w3.org/2000/svg"><defs>${scene.defs}</defs>${scene.body}${protractor(scene.anchors.leftShoulder)}</svg>
<div class="floor"></div><div class="scrim"></div>
<div class="copy">${lockupSvg({ markVariant: "tile", color: HEX.foreground }).replace("<svg ", '<svg class="lockup" ')}
<h1><span>Pose${dot}</span><span>Light${dot}</span><span>Draw${dot}</span></h1>
<p>A free 3D artist mannequin in your browser.</p></div>
</body></html>`;
}

export const OG_ALT =
  "Artikin — Pose. Light. Draw. A faceless wooden artist mannequin reaching toward a glowing light bulb, next to the text: A free 3D artist mannequin in your browser.";
