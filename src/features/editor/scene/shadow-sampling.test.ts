import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { POINT_SHADOW_SAMPLES, patchPointShadowSampling } from "./shadow-sampling";

describe("patchPointShadowSampling", () => {
  const original = () => ({ shadowmap_pars_fragment: THREE.ShaderChunk.shadowmap_pars_fragment });

  it("replaces the noisy point-light kernel of the installed three.js with a fixed one", () => {
    const chunks = original();
    expect(patchPointShadowSampling(chunks)).toBe(true);
    const patched = chunks.shadowmap_pars_fragment;
    const point = patched.slice(patched.indexOf("float getPointShadow( samplerCubeShadow"));
    expect(point).toContain(`i < ${POINT_SHADOW_SAMPLES}; i ++`);
    expect(point).toContain(`vogelDiskSample( i, ${POINT_SHADOW_SAMPLES}, phi )`);
    expect(point.slice(0, point.indexOf("#elif"))).not.toContain("interleavedGradientNoise");
    // Directional / spot shadows are left as they are.
    const flat = patched.slice(0, patched.indexOf("float getPointShadow( samplerCubeShadow"));
    expect(flat).toBe(original().shadowmap_pars_fragment.slice(0, flat.length));
  });

  it("is idempotent and leaves unknown chunk layouts untouched", () => {
    const chunks = original();
    patchPointShadowSampling(chunks);
    const once = chunks.shadowmap_pars_fragment;
    expect(patchPointShadowSampling(chunks)).toBe(true);
    expect(chunks.shadowmap_pars_fragment).toBe(once);

    const unknown = { shadowmap_pars_fragment: "float getPointShadow( samplerCubeShadow shadowMap ) { return 1.0; }" };
    expect(patchPointShadowSampling(unknown)).toBe(false);
    expect(unknown.shadowmap_pars_fragment).toBe("float getPointShadow( samplerCubeShadow shadowMap ) { return 1.0; }");
  });
});
