import type { Metadata } from "next";

import { GuestEditor } from "@/features/editor/persistence/guest-editor";

export const metadata: Metadata = {
  title: "Editor",
  description: "Pose a 3D mannequin, light it with bulbs and export a reference image — no account needed.",
};

/** Guest editor (PROJECT F13): the scene is kept as a draft in this browser; "Save to cloud" (S4). */
export default function EditorPage() {
  return <GuestEditor />;
}
