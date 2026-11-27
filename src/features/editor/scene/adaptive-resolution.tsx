"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { PixelRatioPolicy, type RenderQuality, restPixelRatio } from "../lib/render-quality";
import { useEditorStore } from "../store/context";
import { SETTLE_MS, useInteraction } from "./interaction";
import { syncOutlineViewport } from "./mannequin";

/** Feeds drag gestures (gizmo, IK handle, bulb, Move tool, sliders) into the interaction tracker. */
export function GestureTracking() {
  const store = useEditorStore();
  const tracker = useInteraction();
  useEffect(() => {
    let active = false;
    const apply = (gestureActive: boolean) => {
      if (gestureActive === active) return;
      active = gestureActive;
      if (active) tracker.begin("gesture");
      else tracker.end("gesture");
    };
    apply(store.getState().gestureActive);
    const unsubscribe = store.subscribe((state) => apply(state.gestureActive));
    return () => {
      unsubscribe();
      if (active) tracker.end("gesture");
    };
  }, [store, tracker]);
  return null;
}

/**
 * Adaptive resolution (ARCHITECTURE §9.8): the pixel ratio is chosen per frame from the quality
 * preference — full ratio at rest, lower while interacting — and applied in a frame callback before
 * the render, so the canvas resize and the new image land in the same task (no blank frame).
 *
 * A frame counts as interactive while a drag/orbit holds the pointer, shortly after the last camera
 * change, or when the camera changed during the previous frame — so slow continuous motion (damping,
 * turntable) never flips back to full resolution between frames. Once no frame is queued and the
 * view has settled, one full-quality frame is rendered.
 */
export function AdaptiveResolution({ quality }: { quality: RenderQuality }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const tracker = useInteraction();
  const policy = useRef<PixelRatioPolicy | null>(null);
  const frame = useRef({ previousStart: 0, lastInteractive: 0, restore: false });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      timer = null;
      if (tracker.active || getState().internal.frames > 0) {
        timer = setTimeout(check, SETTLE_MS);
        return;
      }
      if (gl.getPixelRatio() === restPixelRatio(quality, window.devicePixelRatio || 1)) return;
      frame.current.restore = true;
      invalidate();
    };
    const unsubscribe = tracker.subscribe((active) => {
      if (!active && !timer) timer = setTimeout(check, 0);
    });
    // A quality change re-renders at once (rest frame).
    invalidate();
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [tracker, invalidate, getState, gl, quality]);

  useFrame(() => {
    const p = (policy.current ??= new PixelRatioPolicy());
    const f = frame.current;
    const device = window.devicePixelRatio || 1;
    const now = performance.now();
    const moving = tracker.pointerBusy || tracker.active || tracker.lastActivityAt >= f.previousStart;
    const interactive = moving && !f.restore;
    f.restore = false;
    f.previousStart = now;
    if (interactive && f.lastInteractive > 0) p.sample(quality, device, now - f.lastInteractive);
    f.lastInteractive = interactive ? now : 0;
    const ratio = p.pixelRatio(quality, device, interactive);
    if (gl.getPixelRatio() !== ratio) {
      gl.setPixelRatio(ratio);
      p.skip();
    }
    // Toon outlines keep their rest-resolution width while the resolution drops.
    const rest = restPixelRatio(quality, device);
    tracker.setAtRestResolution(ratio === rest);
    syncOutlineViewport(size.width * rest, size.height * rest);
  }, -10);

  return null;
}
