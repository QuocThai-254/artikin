import type { Dof } from "@/lib/mannequin/rom";

/** One color per semantic DOF — shared by the gizmo rings and the slider dots. */
export const DOF_COLORS: Readonly<Record<Dof, string>> = {
  flex: "#ff6b6b",
  twist: "#51cf66",
  side: "#4dabf7",
};
