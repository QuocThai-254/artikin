"use client";

/**
 * Small imperative helpers for three.js objects owned by R3F. Mutations live here (module-level
 * functions) so components stay compatible with the React Compiler lint rules: components hand
 * objects to these functions instead of assigning properties on values returned from hooks.
 */

import * as THREE from "three";
import type { HighlightUniforms } from "@/lib/mannequin/materials";

export function setCursor(el: HTMLElement, cursor: string) {
  if (el.style.cursor !== cursor) el.style.cursor = cursor;
}

export function setObjectVisible(object: THREE.Object3D, visible: boolean) {
  object.visible = visible;
}

export function setSceneBackground(scene: THREE.Scene, color: string | null) {
  scene.background = color ? new THREE.Color(color) : null;
}

/** Vertical field of view (degrees) for a focal length on a 36 × 24 mm sensor (ARCHITECTURE §9.6). */
export function fovFromFocalLength(mm: number): number {
  return (2 * Math.atan(24 / (2 * mm)) * 180) / Math.PI;
}

export function applyLens(camera: THREE.Camera, focalLengthMm: number) {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  camera.fov = fovFromFocalLength(focalLengthMm);
  camera.near = 0.03;
  camera.far = 300;
  camera.updateProjectionMatrix();
}

/** Update the per-figure highlight uniforms; returns true when something changed. */
export function setHighlight(
  uniforms: HighlightUniforms,
  selected: number,
  hover: number,
  all: boolean,
): boolean {
  const a = all ? 1 : 0;
  if (uniforms.uSelectedBone.value === selected && uniforms.uHoverBone.value === hover && uniforms.uSelectAll.value === a) {
    return false;
  }
  uniforms.uSelectedBone.value = selected;
  uniforms.uHoverBone.value = hover;
  uniforms.uSelectAll.value = a;
  return true;
}

export function setMaterialColor(material: THREE.Material, color: string) {
  if ("color" in material && material.color instanceof THREE.Color) material.color.set(color);
}

export function setViewport(target: { value: THREE.Vector2 }, width: number, height: number) {
  target.value.set(width, height);
}

export function setControlsEnabled(controls: unknown, enabled: boolean) {
  if (controls && typeof controls === "object" && "enabled" in controls) {
    (controls as { enabled: boolean }).enabled = enabled;
  }
}

/** Live text without a React render (e.g. a value readout updated on every pointer move). */
export function setText(element: HTMLElement | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}
