"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { useEditor } from "../store/context";
import { type OverlayPrograms, compileOverlayPrograms, installOverlayPrograms } from "./overlay-programs";

/** Keeps gizmo / handle shader programs compiled for the session (see `overlay-programs.ts`). */
export function OverlayProgramCache() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // Light count, visibility and shadows are part of three's program keys: recompile when they change.
  const lights = useEditor((s) => s.scene.lights.map((l) => `${l.visible ? 1 : 0}${l.castShadow ? 1 : 0}`).join(""));
  const programs = useRef<OverlayPrograms | null>(null);

  useEffect(() => {
    const installed = installOverlayPrograms(scene);
    programs.current = installed;
    return () => {
      programs.current = null;
      installed.dispose();
    };
  }, [scene]);

  useEffect(() => {
    if (programs.current) compileOverlayPrograms(gl, camera, scene, programs.current);
  }, [gl, camera, scene, lights]);

  return null;
}
