"use client";

import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";

import { installShadowCache } from "./shadow-signature";

/** Redraws point-light shadow maps only when casters or lights change (see `installShadowCache`). */
export function ShadowCache() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => installShadowCache(gl, scene), [gl, scene]);
  return null;
}
