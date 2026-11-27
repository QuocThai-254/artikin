# Import your own model — screenshots (S8, gate G6)

Captured from the real editor (`/editor`, production build with `NEXT_PUBLIC_E2E=1` on
localhost) with Playwright's bundled Chromium headless shell on the D3D11 WARP software rasterizer
(no GPU), 1440 × 900. Every request to anything other than the local server was blocked and logged
during the capture: none was attempted, and no request carried model bytes.

**Only original test humanoids generated in code appear here** (`src/lib/model-import/testing/
humanoid-fixture.ts`: a VRM 1.0 in T-pose, a Mixamo-style GLB in A-pose measured in centimetres).
No third-party or character model is used, bundled or shown (PROJECT §15).

| File | Shows | Test ids |
|---|---|---|
| `01-import-dialog.png` | Import dialog: chosen file, the rights confirmation, the privacy note (the file and any picture of it stay on this device; no workspace thumbnail while a model is shown) | `model-import-dialog`, `model-import-file-input`, `model-import-rights`, `model-import-submit` |
| `02-vrm-imported-figure-panel.png` | The VRM on the default figure, selected as a whole (faint x-ray tint with rim glow); figure panel "Body model" section — mannequin-only controls (body preset, material, proportions) are hidden | `figure-model-section`, `figure-model-name`, `figure-model-replace`, `figure-model-use-mannequin` |
| `03-preset-and-fk-gizmo.png` | "Fighting stance" pose preset retargeted to the model; left forearm picked, FK gizmo rings on the elbow | `pose-preset-*`, `bone-picker` (S2/S5) |
| `04-ik-handles.png` | Drag tool: IK handles on the model's hands, feet, head and hips (the model's own limb lengths) | S2's IK handles |
| `05-picking-selected-and-hovered-bones.png` | Picking through the per-bone proxy capsules: left upper arm selected (with its gizmo), right thigh hovered | — |
| `06-vrm-glb-and-mannequin-shadows.png` | Front view: procedural mannequin, the VRM and the Mixamo-style GLB side by side; the models keep their own materials and cast/receive shadows | `add-figure-import-model` |
| `07-locked.png` | Master lock on: presets disabled, the scene still renders the models | S2's lock |
| `08-exported-png.png` | The file produced by Export PNG (1×): helpers and highlights hidden | `export-submit` (S2) |
| `09-missing-file-fallback.png` | Another browser profile without the files: both model figures show the mannequin with their pose kept, a notice and "Re-import the file…" | `figure-model-missing`, `figure-model-reimport` |
| `10-saved-models.png` | "Saved models" list (this browser only): use or remove | `local-models-dialog`, `local-model-item`, `local-model-use`, `local-model-remove` |
