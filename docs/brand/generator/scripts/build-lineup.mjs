// Proportion lineup for the "Anime age & build presets" specimen: body presets from PROJECT §8.1
// drawn to one scale (metres) with head-unit ticks per figure. Original procedural artwork.
import { writeFileSync, mkdirSync } from "node:fs";
import { buildMannequin, bodyFor, STAND_POSE } from "./mannequin.mjs";
import { rasterize } from "./raster.mjs";
import { HEX } from "./brand-lib.mjs";

export const LINEUP = [
  {
    id: "classic-wooden",
    name: "Classic Wooden",
    heightM: 1.75,
    heads: 7.5,
    build: 1,
    shoulders: 1,
    material: "wood",
  },
  {
    id: "anime-child",
    name: "Anime Child",
    age: "~10 y",
    heightM: 1.4,
    heads: 5.5,
    build: 0.86,
    shoulders: 0.92,
    material: "toon",
  },
  {
    id: "anime-teen-boy",
    name: "Anime Teen Boy",
    age: "~15 y",
    heightM: 1.68,
    heads: 6.5,
    build: 0.9,
    shoulders: 0.95,
    material: "toon",
  },
  {
    id: "anime-young-man",
    name: "Anime Young Man",
    age: "~19 y",
    heightM: 1.83,
    heads: 7.5,
    build: 1,
    shoulders: 1.08,
    material: "toon",
  },
  {
    id: "anime-compact-adult",
    name: "Anime Compact Adult",
    heightM: 1.6,
    heads: 7,
    build: 1.18,
    shoulders: 1.1,
    material: "toon",
  },
];

const f = (n) => +n.toFixed(1);
const UNITS_PER_M = 1007 / 1.83;
const GAP = 372;
const X0 = 330;
const LENGTHS = [
  "neckLen",
  "chestH",
  "pelvisH",
  "waistR",
  "thighLen",
  "shinLen",
  "upperArmLen",
  "forearmLen",
  "footScale",
];

/** Builds a preset and corrects body lengths so the rendered head top lands exactly on its target height. */
function fitted(p, i) {
  const H = p.heightM * UNITS_PER_M;
  let body = bodyFor({
    heightM: p.heightM,
    heads: p.heads,
    build: p.build,
    shoulders: p.shoulders,
  });
  let m;
  for (let pass = 0; pass < 3; pass++) {
    m = buildMannequin({ pose: STAND_POSE, body, id: `ln${i}`, material: p.material, rim: false });
    const actualTop = m.anchors.head[1] - body.headH / 2;
    const k = (H - body.headH) / (1000 - actualTop - body.headH);
    if (Math.abs(k - 1) < 0.002) break;
    body = { ...body, ...Object.fromEntries(LENGTHS.map((key) => [key, body[key] * k])) };
  }
  return { m, H };
}

const figures = LINEUP.map((p, i) => {
  const { m, H } = fitted(p, i);
  const x = X0 + i * GAP;
  const head = H / p.heads;
  const ticks = Array.from({ length: Math.floor(p.heads) + 1 }, (_, k) => 1000 - k * head);
  if (p.heads % 1) ticks.push(1000 - H);
  const tickSvg = ticks
    .map(
      (y, k) =>
        `<line x1="${f(x + 132)}" x2="${f(x + (k === 0 || y === 1000 - H ? 152 : 146))}" y1="${f(y)}" y2="${f(y)}"/>`,
    )
    .join("");
  return {
    ...p,
    x,
    top: 1000 - H,
    figureSvg: `<g transform="translate(${x} 0)">${m.body}</g>`,
    tickSvg: `<line x1="${f(x + 132)}" x2="${f(x + 132)}" y1="${f(1000 - H)}" y2="1000"/>${tickSvg}`,
    defs: m.defs,
  };
});

const ruler = [0, 0.5, 1, 1.5, 2]
  .map((mtr) => {
    const y = 1000 - mtr * UNITS_PER_M;
    return `<line x1="40" x2="${mtr % 1 ? 62 : 74}" y1="${f(y)}" y2="${f(y)}"/><text x="86" y="${f(y + 9)}">${mtr.toFixed(1)} m</text>`;
  })
  .join("");

const width = X0 + (LINEUP.length - 1) * GAP + 230;
const top = 1000 - 2.05 * UNITS_PER_M;
const vb = [0, f(top), width, f(1060 - top)];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" role="img" aria-label="Five mannequins drawn to scale: Classic Wooden 1.75 m (7.5 heads); toon-shaded Anime Child 1.40 m (5.5 heads), Anime Teen Boy 1.68 m (6.5 heads), Anime Young Man 1.83 m (7.5 heads) and Anime Compact Adult 1.60 m (7 heads)">
<title>Body presets drawn to scale</title>
<defs>${figures.map((g) => g.defs).join("")}</defs>
<g stroke="#FFFFFF" stroke-opacity=".16" stroke-width="2">${[0.5, 1, 1.5, 2].map((mtr) => `<line x1="40" x2="${width - 20}" y1="${f(1000 - mtr * UNITS_PER_M)}" y2="${f(1000 - mtr * UNITS_PER_M)}" stroke-dasharray="4 10"/>`).join("")}</g>
<g stroke="#FFFFFF" stroke-opacity=".55" stroke-width="2.5" fill="#A8A8B1" font-family="Geist Mono, ui-monospace, monospace" font-size="26">${ruler}<line x1="40" x2="40" y1="${f(1000 - 2 * UNITS_PER_M)}" y2="1000"/></g>
${figures.map((g) => `<ellipse cx="${g.x}" cy="1002" rx="${f(70 * (g.heightM / 1.83))}" ry="10" fill="#000" opacity=".55"/>`).join("")}
<g stroke="${HEX.amber}" stroke-width="3" stroke-linecap="round">${figures.map((g) => g.tickSvg).join("")}</g>
${figures.map((g) => g.figureSvg).join("")}
<line x1="20" x2="${width - 20}" y1="1000" y2="1000" stroke="#FFFFFF" stroke-opacity=".35" stroke-width="2"/>
</svg>`;

for (const dir of ["public", "brand", "src/landing", "out"]) mkdirSync(dir, { recursive: true });
writeFileSync("brand/proportion-lineup.svg", svg);
writeFileSync("public/proportion-lineup.svg", svg);
writeFileSync(
  "src/landing/lineup.json",
  JSON.stringify(
    {
      viewBox: vb,
      figures: figures.map(({ id, name, age, heightM, heads, material, x }) => ({
        id,
        name,
        age: age ?? null,
        heightM,
        heads,
        material,
        xPct: +((x / width) * 100).toFixed(2),
      })),
    },
    null,
    2,
  ),
);
const [png] = await rasterize([
  { svg, width: 1000, height: Math.round((1000 * vb[3]) / vb[2]), transparent: false },
]);
writeFileSync("out/proportion-lineup.png", png);
console.log(
  `proportion-lineup.svg ${(svg.length / 1024).toFixed(1)} KB`,
  figures.map((g) => `${g.id}: top ${f(g.top)}`).join(", "),
);
