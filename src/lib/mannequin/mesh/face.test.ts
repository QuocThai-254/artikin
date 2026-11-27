import { describe, expect, it } from "vitest";
import { getFigureModel } from "../figure-model";
import { getBodyPreset, BODY_PRESETS } from "../presets/body";
import { computeSkeleton, type SkeletonLayout } from "../proportions";
import { type Vec3, quatConjugate, quatRotateVec3, vecSub } from "../quat";
import { BONE_INDEX, buildMannequinGeometry, type MannequinGeometryData } from "./build";
import {
  DEFAULT_FACE_STYLE_ID,
  FACE_STYLE_BY_PRESET,
  FACE_STYLE_IDS,
  FACE_STYLES,
  type FaceStyleId,
  createFaceRelief,
  faceStyleForPreset,
} from "./face";
import { HEAD_CHIN_Y, headSurface } from "./head";
import { densitySamples } from "./surface";

/** Triangles per figure with the faceless 34 × 26 egg head (before ADR-061). */
const FACELESS_TRIANGLES = 28_496;

interface HeadVertex {
  /** Head-local position in head heights; h is the height above the chin. */
  x: number;
  h: number;
  z: number;
  /** Forward offset from the plain egg at the same surface parameters (head heights). */
  relief: number;
  row: number;
  col: number;
}

/** The head part of a built figure, in the head bone's frame, with each vertex's relief. */
function headVertices(
  layout: Readonly<SkeletonLayout>,
  data: Readonly<MannequinGeometryData>,
  face: FaceStyleId,
) {
  const part = data.parts.find((p) => p.name === "head");
  if (!part) throw new Error("head part missing");
  const hh = layout.dims.headHeight;
  const { egg, us, vs } = headSurface(layout.dims, FACE_STYLES[face]);
  const inverse = quatConjugate(layout.restOrientations.head);
  const vertices: HeadVertex[] = [];
  for (let k = 0; k < part.count; k++) {
    const i = part.start + k;
    const world: Vec3 = [
      data.positions[3 * i],
      data.positions[3 * i + 1],
      data.positions[3 * i + 2],
    ];
    const [x, y, z] = quatRotateVec3(inverse, vecSub(world, layout.restPositions.head));
    const row = Math.floor(k / us.length);
    const col = k % us.length;
    const plain = egg(us[col], vs[row]);
    vertices.push({
      x: x / hh,
      h: y / hh - HEAD_CHIN_Y,
      z: z / hh,
      relief: (z - plain[2]) / hh,
      row,
      col,
    });
  }
  return { part, vertices, us, vs };
}

function build(presetId: string) {
  const preset = getBodyPreset(presetId);
  const layout = computeSkeleton(preset.proportions);
  const face = FACE_STYLE_BY_PRESET[presetId];
  const data = buildMannequinGeometry(layout, face);
  return { layout, data, face, style: FACE_STYLES[face], ...headVertices(layout, data, face) };
}

const FIGURES = BODY_PRESETS.map((p) => build(p.id));

describe("face styles (ADR-061)", () => {
  it("MAN-16: map every body preset to a face style; unknown presets get the neutral face", () => {
    for (const preset of BODY_PRESETS)
      expect(FACE_STYLE_IDS, preset.id).toContain(FACE_STYLE_BY_PRESET[preset.id]);
    expect(faceStyleForPreset("no-such-preset").id).toBe(DEFAULT_FACE_STYLE_ID);
    expect(new Set(Object.values(FACE_STYLE_BY_PRESET)).size).toBe(BODY_PRESETS.length);
  });

  it("MAN-16: keep the preset's face under custom proportions (the model key carries the face)", () => {
    const proportions = getBodyPreset("realistic-female").proportions;
    const female = getFigureModel("realistic-female", { ...proportions, headSize: 0.15 });
    const male = getFigureModel("realistic-male", { ...proportions, headSize: 0.15 });
    expect(female.layout).toEqual(male.layout);
    expect(female.key).not.toBe(male.key);
    expect(female.key.endsWith("|realistic-female")).toBe(true);
    const head = (data: MannequinGeometryData) => data.parts.find((p) => p.name === "head");
    expect(
      Array.from(female.geometry.positions.slice(0, 3 * (head(female.geometry)?.start ?? 0))),
    ).toEqual(Array.from(male.geometry.positions.slice(0, 3 * (head(male.geometry)?.start ?? 0))));
    expect(female.geometry.positions).not.toEqual(male.geometry.positions);
  });

  it("MAN-17: tell men from women: heavier brow and larger nose, fuller lips and a tapered jaw", () => {
    const pairs: [FaceStyleId, FaceStyleId][] = [
      ["realistic-male", "realistic-female"],
      ["anime-teen-male", "anime-teen-female"],
      ["anime-young-male", "anime-young-female"],
    ];
    for (const [m, f] of pairs) {
      const man = FACE_STYLES[m];
      const woman = FACE_STYLES[f];
      expect(man.group).toBe("male");
      expect(woman.group).toBe("female");
      // Brow: heavier and straighter; sockets: deeper and narrower (men) — larger, rounder eyes (women).
      expect(man.brow, m).toBeGreaterThan(2 * woman.brow);
      expect(woman.browArch, f).toBeGreaterThan(man.browArch + 0.5);
      expect(man.eyes.depth, m).toBeGreaterThan(woman.eyes.depth);
      expect(woman.eyes.height, f).toBeGreaterThan(1.3 * man.eyes.height);
      // Nose: longer, wider and larger (men) — smaller, narrower, upturned (women).
      expect(man.nose.projection, m).toBeGreaterThan(1.5 * woman.nose.projection);
      expect(man.nose.width, m).toBeGreaterThan(woman.nose.width);
      expect(man.nose.wings, m).toBeGreaterThan(woman.nose.wings);
      expect(woman.nose.upturn, f).toBeGreaterThan(man.nose.upturn);
      // Mouth: wide and thin (men) — fuller lips with a cupid's bow (women).
      expect(man.mouth.width, m).toBeGreaterThan(woman.mouth.width);
      expect(woman.mouth.bow, f).toBeGreaterThan(man.mouth.bow);
      // Lower face: square chin (men) — soft, narrower chin (women).
      expect(man.chin.square, m).toBeGreaterThan(woman.chin.square);
      expect(man.chin.width, m).toBeGreaterThan(woman.chin.width);
      expect(woman.mouth.upperLip + woman.mouth.lowerLip, f).toBeGreaterThan(
        man.mouth.upperLip + man.mouth.lowerLip,
      );
      expect(woman.jaw, f).toBeGreaterThan(man.jaw);
    }
    expect(FACE_STYLES["neutral-carved"].group).toBe("neutral");
    expect(FACE_STYLES["anime-child"].group).toBe("child");
  });

  it("MAN-17: place the features in order from chin to brow, sockets apart from the centreline", () => {
    for (const style of Object.values(FACE_STYLES)) {
      expect(style.mouthLine, style.id).toBeGreaterThan(0.1);
      expect(style.noseBase - style.mouthLine, style.id).toBeGreaterThan(0.04);
      expect(style.eyeLine - (style.noseBase + style.nose.tip), style.id).toBeGreaterThan(0.08);
      // The sockets' relief is a function of |x|: it must not reach the centreline (no crease there).
      expect(style.eyes.spacing - style.eyes.width, style.id).toBeGreaterThan(0.02);
    }
  });
});

describe("sculpted head geometry", () => {
  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-18 %s: is mirror-symmetric",
    (_, { vertices, us, vs }) => {
      const mirrorCol = us.map((u) => {
        const target = (1.5 - u) % 1;
        return us.findIndex((w) => Math.abs(w - target) < 1e-9 || Math.abs(w - target - 1) < 1e-9);
      });
      expect(mirrorCol.every((c) => c >= 0)).toBe(true);
      for (const v of vertices) {
        const m = vertices[v.row * us.length + mirrorCol[v.col]];
        expect(m.x).toBeCloseTo(-v.x, 5);
        expect(m.h).toBeCloseTo(v.h, 5);
        expect(m.z).toBeCloseTo(v.z, 5);
      }
      expect(vertices.length).toBe(us.length * vs.length);
    },
  );

  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-19 %s: the nose tip is the most forward point of the head",
    (_, { vertices, style }) => {
      const tip = vertices.reduce((best, v) => (v.z > best.z ? v : best));
      expect(Math.abs(tip.x)).toBeLessThan(1e-5);
      expect(tip.h).toBeGreaterThan(style.noseBase);
      expect(tip.h).toBeLessThan(style.noseBase + style.nose.tip + 0.03);
      expect(tip.relief).toBeGreaterThan(0.6 * style.nose.projection);
    },
  );

  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-20 %s: the eye sockets are recessed below the plain egg",
    (_, { vertices, style }) => {
      const e = style.eyes;
      const socket = vertices.filter(
        (v) =>
          Math.abs(Math.abs(v.x) - e.spacing) < 0.6 * e.width &&
          v.h > style.eyeLine &&
          v.h < style.eyeLine + 1.2 * e.height,
      );
      expect(socket.length).toBeGreaterThan(8);
      const deepest = Math.min(...socket.map((v) => v.relief));
      expect(deepest).toBeLessThan(-0.4 * e.depth);
      // …and both sockets equally (mirror pairs).
      const left = Math.min(...socket.filter((v) => v.x > 0).map((v) => v.relief));
      const right = Math.min(...socket.filter((v) => v.x < 0).map((v) => v.relief));
      expect(left).toBeCloseTo(right, 5);
    },
  );

  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-21 %s: closed lips sit between the nose and the chin",
    (_, { style }) => {
      const relief = createFaceRelief(style);
      const { mouthLine: hm, mouth } = style;
      const along = (h: number) => relief.offset(0, h);
      // Upper and lower lip both stand out from the line between them.
      expect(along(hm + 0.65 * mouth.thickness)).toBeGreaterThan(along(hm));
      expect(along(hm - 0.95 * mouth.thickness)).toBeGreaterThan(along(hm));
      // Between the chin (h = 0) and the nose base, below the nose's underside.
      expect(hm + 1.7 * mouth.thickness).toBeLessThan(style.noseBase);
      expect(hm - 2 * mouth.thickness).toBeGreaterThan(0);
    },
  );

  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-22 %s: every face vertex is rigidly skinned to the head",
    (_, { data, part, vertices }) => {
      expect(new Set(data.boneIndices.slice(part.start, part.start + part.count))).toEqual(
        new Set([BONE_INDEX.head]),
      );
      expect(vertices.filter((v) => Math.abs(v.relief) > 1e-4).length).toBeGreaterThan(300);
    },
  );

  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-22 %s: stays within the triangle budget (≤ +15 %%)",
    (_, { data }) => {
      expect(data.indices.length / 3).toBeLessThanOrEqual(1.15 * FACELESS_TRIANGLES);
      expect(data.vertexCount).toBeLessThan(30000);
    },
  );

  it("MAN-22: scales with the head size (the face is defined in head heights)", () => {
    const small = getFigureModel("classic-wooden");
    const big = getFigureModel("classic-wooden", { headSize: 0.2 });
    const tip = (m: typeof small) => {
      const { vertices } = headVertices(m.layout, m.geometry, "neutral-carved");
      return vertices.reduce((best, v) => (v.z > best.z ? v : best));
    };
    const a = tip(small);
    const b = tip(big);
    expect(b.h).toBeCloseTo(a.h, 4);
    expect(b.z).toBeCloseTo(a.z, 4);
    expect(big.layout.dims.headHeight / small.layout.dims.headHeight).toBeGreaterThan(1.4);
  });

  it.each(FIGURES.map((f) => [f.face, f] as const))(
    "MAN-22 %s: marks the lid creases, nostrils and lip line as cel cavities",
    (_, { data, part, vertices, style }) => {
      const cavity = data.toonCavity;
      if (!cavity) throw new Error("toon cavities missing");
      expect(cavity.length).toBe(data.vertexCount);
      for (let i = 0; i < data.vertexCount; i++) {
        expect(cavity[i]).toBeGreaterThanOrEqual(0);
        expect(cavity[i]).toBeLessThanOrEqual(1);
        if (i < part.start || i >= part.start + part.count) expect(cavity[i]).toBe(0);
      }
      const marked = vertices.filter((_, k) => cavity[part.start + k] > 0.5);
      const near = (cx: number, ch: number, rx: number, rh: number) =>
        marked.some((v) => Math.abs(Math.abs(v.x) - cx) < rx && Math.abs(v.h - ch) < rh);
      const e = style.eyes;
      expect(near(e.spacing, style.eyeLine + 0.6 * e.height, 0.5 * e.width, 0.8 * e.height)).toBe(
        true,
      );
      expect(near(0, style.noseBase + 0.2 * style.nose.tip, 0.5 * style.nose.width, 0.03)).toBe(
        true,
      );
      expect(near(0, style.mouthLine, 0.5 * style.mouth.width, 0.02)).toBe(true);
      // Only the features: a small share of the head.
      expect(marked.length).toBeLessThan(0.08 * vertices.length);
    },
  );

  it("MAN-22: gives cel shading smooth normals on the face only", () => {
    const { data, part } = FIGURES[0];
    const n = data.normals;
    const t = data.toonNormals;
    if (!t) throw new Error("toon normals missing");
    expect(t.length).toBe(n.length);
    let differ = 0;
    for (let i = 0; i < data.vertexCount; i++) {
      expect(Math.hypot(t[3 * i], t[3 * i + 1], t[3 * i + 2])).toBeCloseTo(1, 5);
      const same =
        Math.abs(t[3 * i] - n[3 * i]) +
          Math.abs(t[3 * i + 1] - n[3 * i + 1]) +
          Math.abs(t[3 * i + 2] - n[3 * i + 2]) <
        1e-9;
      const onHead = i >= part.start && i < part.start + part.count;
      if (!onHead) expect(same).toBe(true);
      else if (!same) differ++;
    }
    expect(differ).toBeGreaterThan(100);
  });

  it("samples grids densest where the density is highest", () => {
    const s = densitySamples((t) => (t < 0.5 ? 1 : 3), 0, 1, 40);
    expect(s).toHaveLength(41);
    expect(s[0]).toBe(0);
    expect(s[40]).toBe(1);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(s.filter((t) => t > 0.5).length).toBeGreaterThan(2.5 * s.filter((t) => t < 0.5).length);
  });
});
