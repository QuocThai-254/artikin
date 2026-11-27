"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { useEditorStore } from "../store/context";
import type { CaptureOptions } from "../store/editor-store";

export const MAX_EXPORT_EDGE = 4096;

/** Output pixel size for an export: viewport × scale, longest edge capped at 4096 px. */
export function exportSize(viewport: { width: number; height: number }, scale: number): { width: number; height: number } {
  let w = Math.max(1, Math.round(viewport.width * scale));
  let h = Math.max(1, Math.round(viewport.height * scale));
  const longest = Math.max(w, h);
  if (longest > MAX_EXPORT_EDGE) {
    const k = MAX_EXPORT_EDGE / longest;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return { width: w, height: h };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), type, quality);
  });
}

/**
 * PNG export & thumbnails (ARCHITECTURE §9.9): hide helpers (gizmos, handles, highlights,
 * optionally bulbs/floor), optionally clear to transparent, render once at a higher pixel ratio,
 * read the canvas in the same task, restore.
 */
export function CaptureController() {
  const store = useEditorStore();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const capture = async (options: CaptureOptions): Promise<Blob> => {
      const hidden: THREE.Object3D[] = [];
      const hide = (o: THREE.Object3D) => {
        if (o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      };
      scene.traverse((o) => {
        const role = o.userData?.artikinRole as string | undefined;
        if (role === "helper") hide(o);
        if (role === "bulb" && !options.includeBulbs) hide(o);
        if ((role === "floor" || role === "grid") && !options.includeFloor) hide(o);
      });
      // Highlights are shader uniforms: temporarily clear selection & hover.
      const { selection, hover } = store.getState();
      store.setState({ selection: { kind: "none" }, hover: null });
      const prevBackground = scene.background;
      const prevClearAlpha = gl.getClearAlpha();
      const prevPixelRatio = gl.getPixelRatio();
      if (options.transparent) {
        scene.background = null;
        gl.setClearAlpha(0);
      }
      const target = options.size ?? exportSize(size, options.scale);
      const ratio = (options.size ? Math.max(target.width / size.width, target.height / size.height) : target.width / size.width);
      try {
        gl.setPixelRatio(ratio);
        gl.setSize(size.width, size.height, false);
        gl.render(scene, camera);
        const source = gl.domElement;
        let out: HTMLCanvasElement = source;
        if (options.size) {
          // Crop (cover) to the requested aspect ratio.
          out = document.createElement("canvas");
          out.width = target.width;
          out.height = target.height;
          const ctx = out.getContext("2d");
          if (!ctx) throw new Error("2D canvas unavailable");
          const scale = Math.max(target.width / source.width, target.height / source.height);
          const sw = target.width / scale;
          const sh = target.height / scale;
          ctx.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, target.width, target.height);
        } else if (source.width !== target.width || source.height !== target.height) {
          out = document.createElement("canvas");
          out.width = target.width;
          out.height = target.height;
          out.getContext("2d")?.drawImage(source, 0, 0, target.width, target.height);
        }
        // toBlob must read the WebGL canvas in the same task as the render (preserveDrawingBuffer: false).
        const pending = canvasToBlob(out, options.type ?? "image/png", options.quality);
        return await pending;
      } finally {
        gl.setPixelRatio(prevPixelRatio);
        gl.setSize(size.width, size.height, false);
        scene.background = prevBackground;
        gl.setClearAlpha(prevClearAlpha);
        for (const o of hidden) o.visible = true;
        store.setState({ selection, hover });
        invalidate();
      }
    };
    store.getState().setEngine({ capture });
    return () => store.getState().setEngine({ capture: undefined });
  }, [store, gl, scene, camera, size, invalidate]);

  return null;
}
