# Engine & editor screenshots (S2, gate G2)

Captured from the guest editor (`/editor`, dev server on localhost) with Playwright's bundled
Chromium headless shell on the D3D11 WARP software rasterizer (no GPU), 1280 × 800, DSF 1. Most
images are cropped to the 3D canvas; all use the default lighting (key bulb at `[1.1, 2.4, 0.9]`,
45 %, ambient 25 %). All geometry and textures are procedural (original assets).

| File | Shows | Test ids |
|---|---|---|
| `00` | Default view of a new scene: whole figure head-to-toe and the key bulb (grab it without zooming out) | — |
| `01`–`04` | Default wooden figure with the neutral carved face: ¾, front, side, back (egg head, ball joints); refreshed 2026-11-27 for the sculpted faces (view presets ¾ R, Front, Left, Back) | VIS-01 |
| `05` | Hand: palm, wrist ball, three-phalanx fingers, thumb | VIS-01 |
| `06` | Posed figure: bent elbows and knee, turned head, curled fingers | VIS-01 |
| `07` | Curled fingers with an opposed thumb (close-up) | VIS-01 |
| `08` | Hover highlight (chest, Rotate tool) | POSE-12 |
| `09` | Selected forearm: blue segment, flexion + pronation rings only | POSE-12, VIS-05 |
| `10` | Knee gizmo: a single flexion ring | POSE-12, VIS-05 |
| `11` | Shoulder (upper arm) gizmo: three rings | VIS-05 |
| `12` | After real mouse drags on the knee ring (value stayed in −5…155°, one undo step per drag) | POSE-03 |
| `13` | IK handles (Drag tool): hands, feet, head, hips | POSE-12, VIS-05 |
| `14` | After real IK drags of the left hand (up) and right foot | POSE-04 |
| `15` | Move tool: figure dragged across the floor, turn ring, whole-figure rim highlight | POSE-09 |
| `16`–`19` | Bulb intensity 100 % / 50 %, shadows off, ambient 0 | VIS-03 |
| `20` | Materials: wood, clay, plaster, toon (outline) | VIS-03 |
| `21` | 4 figures + 2 shadow-casting bulbs (≈ 7–10 fps on WARP while orbiting; idle = 0 frames) | VIS-03, PERF |
| `22` | Pose lock: badge, status hint, `not-allowed` cursor, no handles | VIS-05 |
| `23` | Master lock after drags on chest, hand handle, head and bulb in every tool: scene unchanged | LOCK-01 |
| `24`, `25` | Properties panel for a joint (anatomical sliders) and for a light | — |
| `26`, `27` | Export dialog and the downloaded PNG (canvas size, helpers hidden) | EXP-01 |
| `28`, `29` | Toon before / after the cel pass (2-step ramp, flat lit + shadow tones, form and cast shadows, outline) | C-02 |
| `30` | Toon with a dim bulb (15 %): more of the figure falls into the shadow tone, colours stay clean | C-02 |
| `31`–`35` | Responsive editor chrome (PROJECT §13.1), captured at their own viewport: phone 390 × 844 compact toolbar, More menu, tool menu, opaque Properties drawer (presets); tablet 768 × 1024 with everything inline and the Scene drawer. No horizontal overflow from 320 to 1440 px (guest and cloud, locked or not) | `toolbar-more`, `toolbar-tool-menu`, `toolbar-panel-*` (A11Y-07) |
| `36` | Scene settings → Display → **Rendering quality (this device)**: Auto (default) / High / Balanced / Low with a one-line explanation; saved per device, not in the scene (ARCHITECTURE §9.8) | `scene-render-quality` |
| `37` | Lock menu with its three parts — **Pose**, **Lights**, **View (camera angle)** (`V`); here pose and lights are locked and the view is free (badge "Pose & lights locked", status "… view still editable") | `lock-menu-view` (LOCK-14) |
| `38` | Master lock (`L`) after an orbit: badge "Locked"; the camera cluster shows "View locked" with greyed, still focusable buttons (tooltip "View locked — press V to unlock"); Scene panel: focal length and turntable disabled; status "Locked · pose, lights and view are fixed". Orbit, wheel, pan, keys 1–5 / F / T do nothing; the angle survives resizes and reloads | `view-locked-badge`, `camera-view-locked` (LOCK-13, LOCK-15) |
| `39` | Phone 390 × 844: the More menu carries the three lock parts; view locked with `V` (status "View locked") | `toolbar-more-lock-view` |
| `40`, `41` | Default view (auto framing, ADR-060) at 1280 × 800 and 1920 × 1080: the whole figure head-to-toe with its floor contact and shadow, the key bulb in view and clear of the camera views; nothing saved (status "Draft") | CAM-11, CAM-12 |
| `42` | Default view on a phone (390 × 844): the bulb stays left of the camera views cluster so it can be grabbed | CAM-12 |
| `43` | Front view preset after zooming in close: presets frame the whole figure head-to-toe with an 8 % margin and the floor below the feet | CAM-14 |

Interaction results recorded with the captures (real mouse input located via `window.__artikin.project`):
knee ring drag `0 → 77°` and back to `−2.1°`, 1 history entry per drag; IK hand drag → 1 entry, all
values within limits; unreachable IK target → identical document over 5 extra moves; Move tool drag
changed x/z only, turn ring yaw −20°; bulb drag moved the light and selected it; master lock: document
unchanged, selection `none`, camera still orbits (since the view lock, ADR-059, that holds for a pose + lights lock; the master lock also freezes the camera, LOCK-13); render on demand: 0 frames in 2 s idle.
