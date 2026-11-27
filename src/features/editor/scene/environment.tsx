"use client";

import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { useEditor } from "../store/context";
import { setSceneBackground } from "./three-helpers";

/** Map the normalized ambient fill (0..1) to hemisphere light intensity (tuned visually). */
export const AMBIENT_SCALE = 3.2;

export function SceneEnvironment() {
  const background = useEditor((s) => s.scene.environment.background);
  const ambient = useEditor((s) => s.scene.environment.ambient);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    setSceneBackground(scene, background);
    invalidate();
  }, [scene, background, invalidate]);

  return (
    <hemisphereLight
      args={["#f4f1ec", "#5d5a55", ambient * AMBIENT_SCALE]}
      position={[0, 10, 0]}
      userData={{ artikinRole: "ambient" }}
    />
  );
}

function floorColor(background: string): THREE.Color {
  const c = new THREE.Color(background);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, hsl.s * 0.6, Math.min(0.9, hsl.l * 1.35 + 0.05));
}

/** Radial floor fade (m from the world origin): the floor blends into the background — no horizon line. */
const FLOOR_FADE_START = 7;
const FLOOR_FADE_END = 22;
/** Grid plane edge length (m, 1 m segments); it fades out (from the origin) before its edge. */
const GRID_SIZE = 40;

/**
 * Floor material that fades into the background colour with distance. The mix happens after tone
 * mapping and the sRGB conversion, so the far floor matches the cleared background exactly.
 */
function createFloorMaterial(background: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: floorColor(background), roughness: 0.96, metalness: 0 });
  const srgb = new THREE.Color(background).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const uniforms = {
    uFadeColor: { value: new THREE.Vector3(srgb.r, srgb.g, srgb.b) },
    uFadeRange: { value: new THREE.Vector2(FLOOR_FADE_START, FLOOR_FADE_END) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFloorXZ;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvFloorXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFadeColor;\nuniform vec2 uFadeRange;\nvarying vec2 vFloorXZ;")
      .replace(
        "#include <colorspace_fragment>",
        "#include <colorspace_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, smoothstep(uFadeRange.x, uFadeRange.y, length(vFloorXZ)));",
      );
  };
  material.customProgramCacheKey = () => "artikin-floor-fade-v1";
  return material;
}

export function Floor() {
  const floor = useEditor((s) => s.scene.environment.floor);
  const background = useEditor((s) => s.scene.environment.background);
  const material = useMemo(() => createFloorMaterial(background), [background]);
  useEffect(() => () => material.dispose(), [material]);
  if (!floor.visible) return null;
  return (
    <group userData={{ artikinRole: "floor" }}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow name="floor" userData={{ artikinRole: "floor" }}>
        <planeGeometry args={[60, 60]} />
        {floor.shadowOnly ? (
          <shadowMaterial opacity={0.42} color="#000000" />
        ) : (
          <primitive object={material} attach="material" />
        )}
      </mesh>
      {floor.grid && (
        // A finite, subdivided plane: drei's infinite grid is two ~1 km triangles whose
        // near-plane clipping breaks the line interpolation at some camera angles (grid vanishes).
        <Grid
          position={[0, 0.002, 0]}
          args={[GRID_SIZE, GRID_SIZE, GRID_SIZE, GRID_SIZE]}
          cellSize={0.25}
          cellThickness={0.6}
          cellColor="#6b6f78"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#8a8f99"
          fadeDistance={FLOOR_FADE_END - 4}
          fadeStrength={1.6}
          fadeFrom={0}
          followCamera={false}
          userData={{ artikinRole: "grid" }}
        />
      )}
    </group>
  );
}
