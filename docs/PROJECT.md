# Artikin — 3D Posable Mannequin Studio for Artists

> **Artikin** (*artist* + *manikin*) is a free, browser-based replacement for the wooden artist
> mannequin: add posable figures with human-like joints, pose them with the mouse, orbit 360°,
> light them with dimmable bulbs to study shadows, lock everything in place, and save your scenes.

| | |
|---|---|
| Document | Product specification — the source of truth for **what** we build and **why** |
| Related | [ARCHITECTURE.md](./ARCHITECTURE.md) (how) · [PROGRESS.md](./PROGRESS.md) (status & handoff) · [../AGENTS.md](../AGENTS.md) (rules for AI agents) |
| Owner | The project owner — chats in Vietnamese; every project artifact (code, comments, docs, UI copy) is English |
| Spec status | v1 — approved for implementation (2026-11-26) |
| Hosting target | Vercel (public URL) + PostgreSQL (Neon via Vercel Marketplace) |
| Repository state | Local only. Git is **not** initialized and nothing is pushed until the owner decides. |

---

## Table of contents

1. [Vision](#1-vision)
2. [Problem & existing alternatives](#2-problem--existing-alternatives)
3. [Goals, non-goals & success metrics](#3-goals-non-goals--success-metrics)
4. [Target users & personas](#4-target-users--personas)
5. [Key user journeys](#5-key-user-journeys)
6. [Feature specification (F1–F15)](#6-feature-specification-f1f15)
7. [Mannequin anatomy: bones & range of motion](#7-mannequin-anatomy-bones--range-of-motion)
8. [Body presets & materials](#8-body-presets--materials)
9. [Lighting model (artist's view)](#9-lighting-model-artists-view)
10. [Lock behavior](#10-lock-behavior)
11. [Accounts, workspaces & limits](#11-accounts-workspaces--limits)
12. [Guest mode](#12-guest-mode)
13. [UI / UX specification](#13-ui--ux-specification)
14. [Non-functional requirements](#14-non-functional-requirements)
15. [Content & intellectual-property policy](#15-content--intellectual-property-policy)
16. [Privacy & data handling](#16-privacy--data-handling)
17. [Assumptions & decisions taken during planning](#17-assumptions--decisions-taken-during-planning)
18. [Roadmap & out of scope](#18-roadmap--out-of-scope)
19. [Open questions for the owner](#19-open-questions-for-the-owner)
20. [Definition of done (v1)](#20-definition-of-done-v1)
21. [Glossary](#21-glossary)

---

## 1. Vision

Artists who draw people need reference poses. A physical wooden mannequin is affordable but
limited: stiff joints, unrealistic ranges of motion, no articulated hands, a single body type,
and lighting that depends on whatever lamp is on the desk. Artikin puts a better mannequin in the
browser:

- **Realistic joints** — neck, shoulders, elbows, wrists, every finger joint, spine, hips, knees,
  ankles and toes — each with an anatomically plausible range of motion (ROM), so an impossible
  pose cannot be created by accident.
- **Direct manipulation** — click a body part and rotate it, or grab a hand or foot and drag it;
  the whole limb follows (inverse kinematics).
- **360° viewing** — orbit, zoom, pan, view presets, lens (focal length) control, turntable.
- **Light & shadow study** — movable light bulbs with adjustable brightness, color temperature and
  shadows that fall on the figure and the floor.
- **Lock** — freeze the pose and the lights, then inspect the figure from any angle without
  nudging anything.
- **Body types for anime artists** — a classic wooden default mannequin plus realistic and
  anime-proportioned age/build presets (child, teen, young adult, compact adult, …), each with its
  own sculpted face (eye sockets, nose, closed lips; male, female, child or neutral), and a
  cel-shaded (toon) material.
- **Accounts & workspaces** — sign in and keep up to **5** saved workspaces (scenes) per account.
- **Zero install** — runs in any modern desktop browser from a public Vercel URL.

## 2. Problem & existing alternatives

| Option | Pain points that Artikin addresses |
|---|---|
| Wooden artist mannequin | Costs money, stiff and unrealistic joints, mitten-like hands, one body type, cannot be "locked", lighting limited to the room. |
| Photo references / pose sites | Fixed camera angle, cannot change pose slightly, lighting not controllable, licensing questions. |
| Desktop 3D tools (Blender, DAZ) | Powerful but heavy, steep learning curve, overkill for a quick drawing reference. |
| Commercial posing apps | Often paid, install-only, or cluttered; few focus on anime proportions + light study + a simple lock. |

Artikin's niche: **free, instant, browser-based, anatomically constrained, anime-friendly, light-study
oriented, with a one-click lock**.

## 3. Goals, non-goals & success metrics

### 3.1 Goals

| ID | Goal |
|---|---|
| G1 | A new user can create a convincing pose in under a minute using only the mouse. |
| G2 | Joints behave like a real body (including fingers); limits prevent impossible poses. |
| G3 | Light & shadow can be studied with movable, dimmable bulbs. |
| G4 | The figure can be inspected from any angle without accidental edits (lock). |
| G5 | Work persists: accounts with up to 5 cloud workspaces each. |
| G6 | Anime-friendly: age/build presets and toon shading. |
| G7 | Public, zero-install web app deployable on Vercel. |

### 3.2 Non-goals (v1)

- Animation, keyframes or timelines.
- Physics, collision avoidance or self-intersection prevention (limits only).
- Facial expressions, hair or clothing. (Faces are in scope since 2026-11-27: one neutral sculpted
  face style per body preset, eyes and mouth closed — F1, §8.1.)
- Phone-first posing UX (phones get best-effort viewing; posing targets desktop/tablet).
- Real-time multi-user collaboration.
- Asset marketplace; importing third-party character models (see roadmap, VRM import).
- Shipping any copyrighted character likeness (see §15).

### 3.3 Success metrics

| Metric | Target |
|---|---|
| Time to first pose (new visitor, guest mode) | < 60 s |
| Frame rate — 1 figure, 1 shadow-casting bulb, 1080p, integrated GPU | ~60 fps |
| Frame rate — 4 figures, 2 shadow-casting bulbs | ≥ 30 fps |
| Joint-limit violations reachable through any input (gizmo, IK, slider, preset, loaded file) | 0 (enforced by tests) |
| Landing page initial JavaScript (no three.js; idle-time link prefetch excluded) | ≤ 160 KB gzipped incl. the Next.js/React framework (≈ 135 KB); landing route-specific JS ≤ 20 KB |
| Data loss on reload after autosave reports "Saved" | 0 |

## 4. Target users & personas

| Persona | Description | Needs |
|---|---|---|
| **Mai — anime/manga illustrator** | Draws the same character at different ages (≈10, ≈15, ≈19 years old) and builds; loves dynamic action poses. | Anime proportions per age, expressive hands, toon shading, quick export. |
| **Huy — art student** | Practices form shading and cast shadows. | One movable light, adjustable brightness, neutral clay material, many viewing angles without breaking the pose. |
| **Lan — comic artist** | Composes 2–4 characters per panel (fights, conversations). | Multiple figures, per-figure lock, several saved scenes. |
| **Visitor** | Arrives from a shared link or search. | Try immediately without signing up; sign up only to save. |

## 5. Key user journeys

| ID | Journey | Steps (happy path) |
|---|---|---|
| J1 | Quick pose as guest | Landing → **Open editor** → default figure appears in a relaxed stance → click forearm → rotate elbow with the gizmo → switch to Drag mode, pull the hand up → orbit around → **Export PNG**. |
| J2 | Shadow study | Select the key light bulb → drag it above-left of the figure → lower intensity → raise ambient slightly → **Lock lights** → orbit to several angles → export. |
| J3 | Multi-character composition | **Add figure** → choose *Anime Teen Boy* → place it beside the first figure → apply *Fighting stance* preset → tweak arms → lock that figure → pose the second one. |
| J4 | Save & resume | Sign up → dashboard shows *0 / 5* → **New workspace** → edit (autosave shows *Saved*) → close tab → come back days later → card shows thumbnail → open → identical scene. |
| J5 | Limit reached | User with 5 workspaces → **New workspace** is disabled with the message "5 / 5 workspaces used — delete one to create another." API refuses a 6th one even if the UI is bypassed. |
| J6 | Guest → account | Guest has a draft → **Save to cloud** → sign up → the draft becomes the user's first workspace and opens in the editor. |
| J7 | Locked inspection & drawing | User finishes a pose → presses **L** (pose, lights and view freeze — draw from this exact angle) → presses **V** to free only the camera → orbits and drags across the figure → nothing changes (pose and lights intact) → presses **L** again to unlock everything. |

## 6. Feature specification (F1–F15)

Priority: **P0** = must ship in v1 · **P1** = should ship in v1 · **P2** = roadmap (not in v1 unless time allows).

### F1 — Posable mannequin (P0)

- Procedurally generated figure: egg-shaped head with a **sculpted face** (eye sockets under a brow
  ridge with closed lids, a nose and closed lips — one style per body preset, §8.1; owner request,
  2026-11-27), neck, chest, abdomen, pelvis, shoulder girdle, upper arms, forearms, hands (palm +
  thumb + four fingers with three phalanges each), thighs, shins, feet and toes. The *Classic
  Wooden* style shows spherical ball joints like a physical artist mannequin.
- **51 bones** (see §7). Every bone except the root is individually selectable and rotatable within
  its range of motion; the root (`hips`) places and orients the whole figure.
- Left/right symmetry: limits mirror exactly between sides.

**Acceptance criteria**
- Each bone listed in §7 can be selected and rotated.
- No input path can produce an angle outside the limits (gizmo, IK, slider, numeric input, presets,
  mirror, loaded workspace — out-of-range values in stored data are clamped on load).
- Changing body preset or proportions never changes the stored pose angles.
- The face is real relief geometry, not paint: a bulb casts form and cast shadows in the eye sockets
  and under the brow, nose and lower lip. It is symmetric, faces the figure's front, scales with the
  head size and the proportion sliders, keeps its preset's style under custom proportions and reads
  cleanly in all four materials (no stray toon outline strokes). Imported models keep their own face.

### F2 — Body presets & proportions (P0; chibi preset P2)

- Preset catalogue in §8. A preset can be chosen when adding a figure and changed later for the
  selected figure; the pose is preserved.
- Proportion sliders for the selected figure: height, head size, neck length, shoulder width, chest
  size, waist, hip width, arm length, leg length, limb thickness, muscularity.
- Materials: Wood, Clay, Toon (cel-shaded + outline), Plaster, plus a tint color.

**Acceptance criteria**
- Switching preset keeps the pose; sliders update the figure live (no reload).
- After a preset/proportion change the figure stays standing on the floor (auto-ground).
- Presets are generic — no copyrighted character names or likenesses (§15).

### F3 — Posing interactions (P0; mirror/swap P1)

| Interaction | Behavior |
|---|---|
| **Select** | Click a body part → selects the bone that moves that part (forearm → elbow/`LowerArm`, hand → wrist/`Hand`, finger segment → that finger joint). Hover highlight; selected part tinted/outlined. Click empty space or press Esc to deselect. |
| **Rotate (FK)** — default tool | A rotation gizmo appears at the selected joint and shows **only the axes that joint can move** (e.g., the knee shows a single ring). Dragging a ring rotates the bone; motion stops smoothly at the limit. |
| **Drag (IK)** | Draggable handles on hands, feet and head (and the hips for whole-body placement). Dragging a hand moves the chain upper arm → forearm → hand so the hand follows the cursor, within limits; unreachable targets stretch as far as possible without jitter. |
| **Sliders** | The properties panel lists every motion of the selected bone with anatomical labels (e.g., *Flexion / Extension*, *Abduction / Adduction*, *Twist*), bounded by the limits, with numeric input. Sliders are the keyboard-accessible alternative to the canvas. |
| **Reset** | Reset bone · reset limb · reset hand · reset whole pose (to neutral) · reset to default relaxed pose. |
| **Mirror / swap** | Copy left → right or right → left; swap sides (flip pose). |
| **Move figure** | Move tool: drag the figure on the floor plane, rotate it around the vertical axis, gizmo for precise moves; **Drop to floor** button. |
| **Presets** | Apply full-body pose presets and hand presets (F10). |

**Acceptance criteria**
- Clicking any segment selects the expected bone (unit-tested mapping).
- The FK gizmo, IK and sliders never exceed limits; IK never produces NaN or visible jitter.
- Every change is undoable (F8); one drag gesture = one undo step.

### F4 — Camera & viewing (P0; focal length, turntable, view presets P1; orthographic P2)

- Orbit **360° horizontally without limit**, vertically from almost straight below to straight above
  (clamped to avoid flipping), zoom, pan.
- View presets: Front, Back, Left, Right, Top, ¾ front-left, ¾ front-right; *Frame selection* (F).
- Lens: focal length 18–200 mm (default 50 mm) to control perspective distortion like a camera.
- Turntable: auto-rotate toggle with adjustable speed.

**Acceptance criteria**
- Camera interaction never changes the pose or lights.
- The camera state is saved with the workspace but is **not** part of undo history.

### F5 — Lighting (P0; color temperature P1; spot/sun lights & lighting presets P2)

- **Light bulbs**: visible bulb objects (glowing sphere) that emit point light and cast shadows.
  Default scene: one key light. Up to **4** lights per scene.
- Per light: position (drag in 3D or numeric X/Y/Z), **intensity 0–100 %**, color temperature
  2000–10000 K (or color picker), cast shadows on/off, shadow softness, visible on/off, name.
- **Ambient fill** 0–100 % (how dark shadows are).
- Shadows: figure self-shadowing + floor shadows; quality setting (low/medium/high).

**Acceptance criteria**
- Moving a light or changing intensity updates lighting and shadows in real time.
- Intensity 0 % turns the light off; shadows appear on both the body and the floor.

### F6 — Lock pose, lights & view (P0)

See §10 for the full behavior table.

- Master **Lock** button (padlock) in the toolbar; shortcut **L**. The master button locks **pose, lights and view** together so the figure, the lights and the exact camera angle stay frozen for drawing (owner request, 2026-11-26). A dropdown toggles each part separately: **Pose**, **Lights**, **View** (camera) — e.g. unlock only the view to look around while pose and lights stay locked. Shortcut **V** toggles the view lock.
- Per-figure lock toggle in the outliner.
- Lock state is saved with the workspace.

**Acceptance criteria**
- With the pose/lights lock on, *no* pointer interaction on the canvas can change any bone or light — verified by
  an E2E test that drags across the figure and the bulb and compares the scene JSON before/after.
- With the view lock on, the camera cannot change: no orbit, zoom or pan, view presets / frame selection / focal length / turntable are disabled, and the angle survives window resizes and reloads.
- With only pose/lights locked, camera orbit/zoom/pan keep working.

### F7 — Scene management (P0; duplicate/rename/hide P1)

- Outliner listing figures and lights: select, rename, show/hide, lock, duplicate, delete.
- **Add figure** (choose a body preset) — up to **8** figures per scene; new figures are placed
  beside existing ones, not inside them.
- Floor on/off, grid on/off, shadow-only floor, background color.

**Acceptance criteria**
- Scene limits (8 figures, 4 lights) are enforced with a friendly message.

### F8 — Undo / redo & shortcuts (undo/redo P0; shortcuts & help dialog P1)

- Undo/redo for every scene edit (pose, transforms, lights, presets, add/remove, proportions,
  materials); depth ≥ 100 steps; one drag gesture = one step; camera moves excluded. Lock/unlock is a
  **mode**, not an undoable edit (otherwise *unlock → undo* would silently re-lock); it is still saved
  with the workspace.
- Keyboard shortcuts — see §13.3. A help dialog (`?`) lists them.

### F9 — Export reference image (P1)

- Export PNG of the current view; options: resolution 1× / 2× / 4× (longest edge capped at 4096 px),
  transparent background, include floor/grid on/off.
- Helpers (gizmos, IK handles, selection highlight, optionally the bulb meshes) are hidden in the
  exported image.

**Acceptance criteria**
- The image framing matches the viewport; no helper is visible.

### F10 — Pose & hand preset library (P1)

- **≥ 15 full-body poses**, e.g.: Relaxed stand (default), T-pose, A-pose, Contrapposto, Walk, Run,
  Jump, Sit on chair, Sit cross-legged, Kneel on one knee, Crouch, Lie on back, Fighting stance,
  Two-handed sword stance, Reach up, Look back over shoulder, Hands on hips, Arms crossed, Thinking
  (hand on chin).
- **≥ 8 hand poses**: Relaxed, Fist, Open/spread, Point, Peace (V), Thumbs up, Grip (holding a
  handle), Pinch, Claw.
- Full-body presets keep the figure's floor position/heading; hand presets apply to left, right or
  both hands.

**Acceptance criteria**
- Every preset respects ROM limits (unit test) and has been visually checked (screenshots stored in
  `docs/screenshots/presets/`).

### F11 — Accounts (P0; OAuth P1)

- Sign up with name, email and password (min 8 characters); sign in; sign out; persistent session.
- Optional **GitHub/Google** sign-in, enabled automatically when the corresponding environment
  variables are configured.
- Clear errors: wrong credentials, email already registered, too many attempts (rate limited).
- Email verification and password reset are **not** in v1 (they need an email provider) — roadmap.

**Acceptance criteria**
- Passwords are stored only as strong hashes; protected pages redirect to sign-in; protected APIs
  return 401 without a valid session.

### F12 — Workspaces (P0; duplicate, thumbnails, conflict handling P1)

- A **workspace** is one saved scene: all figures, poses, proportions, materials, lights, camera,
  environment and lock state, plus a name, a thumbnail and timestamps.
- Dashboard: grid of workspace cards (thumbnail, name, "edited 5 min ago"), usage indicator
  **"3 / 5"**, New, Open, Rename, Duplicate, Delete (with confirmation).
- **Maximum 5 workspaces per user** (configurable server setting, default 5). Enforced atomically on
  the server and mirrored in the UI.
- Editor saving: autosave ≈2 s after the last change, manual save (Ctrl/Cmd+S), status indicator
  (*Saved · Saving… · Unsaved changes · Offline · Error*), warning before leaving with unsaved
  changes, thumbnail refreshed on save (throttled).
- Concurrency: if the workspace changed elsewhere (another tab/device), the user chooses
  *Reload* or *Overwrite*.

**Acceptance criteria**
- Creating or duplicating a 6th workspace fails with a clear message (API `409 WORKSPACE_LIMIT_REACHED`).
- A user can never read or modify another user's workspace (API answers 404).
- Reloading the editor restores exactly the saved scene.

### F13 — Guest mode (P1)

- `/editor` works without an account; the scene is kept as a **draft in the browser** (localStorage)
  and restored on the next visit.
- **Save to cloud** asks the guest to sign in/up; afterwards the draft becomes a new workspace (if the
  user is under the limit; otherwise they pick a workspace to replace, or cancel).

### F14 — Landing page (P1)

- Explains the product, shows a preview image, primary CTA **Open editor** (guest) and secondary
  **Sign in / Sign up**; header shows the user menu when signed in. Good SEO metadata and
  Open Graph image.

### F15 — My presets: save your own figures (P1; owner request 2026-11-27)

The owner asked (2026-11-27): when a user has finished shaping a figure, let them save it as their
own preset to reuse later.

- **Save as my preset…** (figure panel, and the **Mine** tab of the Presets panel) saves the figure's
  **body** — its base body preset (which keeps that preset's face and defaults), every proportion,
  the material style and tint — and, when **Include pose and hands** is ticked (default), its
  **pose**: joint and finger angles and how the figure leans, standing on the floor or lifted.
  Name: 1–60 characters.
- Never saved: an imported model (its file stays on the device), the figure's name, place in the
  scene, heading, visibility and lock state.
- **Mine** tab (Pose · Hands · Body · Mine): the user's presets, newest first, each with a body
  silhouette plus a stick figure when it has a pose. **Apply** to the selected figure (one undo step;
  keeps its place and heading; disabled while the pose is locked; a figure that shows an imported
  model takes only the pose), **Rename**, **Delete** (with confirmation).
- **Add figure** lists **My presets** too: the new figure is shaped and posed by the preset and named
  after it (8-figure limit).
- Presets belong to the **account**: they work in every workspace and on every device. Guests see
  "Sign in to save your own presets" with sign-in / sign-up links back to the editor (the guest scene
  stays in the browser).
- Up to **50 presets per user** (configurable). No sharing between users, no import/export and no
  stored preview images (previews are drawn from the preset).

**Acceptance criteria**
- A preset saved in one workspace is listed after a reload and in any other workspace; applying it
  reproduces its body and pose on the target figure, keeps that figure's place and heading, and is
  one undo step.
- Saving a 51st preset fails with a clear message (API `409 PRESET_LIMIT_REACHED`); the save dialog
  says so before saving.
- A user can never read, rename or delete another user's preset (API answers 404).
- Opening the editor makes no preset request; the list is fetched when first needed.

## 7. Mannequin anatomy: bones & range of motion

### 7.1 Conventions

- World: **Y up**, the figure faces **+Z**, the figure's left side is **+X**, units are meters,
  the floor is the plane `y = 0`.
- **Neutral (all-zero) pose**: standing upright, arms hanging at the sides with palms facing the
  thighs, fingers straight, thumb relaxed next to the index finger, legs straight, feet parallel and
  pointing forward. The *default* pose applied to new figures is a slightly relaxed version of this
  (preset *Relaxed stand*).
- Bone names follow the **VRM 1.0 humanoid** naming (e.g., `leftUpperArm`), which keeps the door
  open for importing user avatars later (roadmap). A bone rotates the segment it is named after,
  around the joint at its base (e.g., `leftLowerArm` = elbow + forearm twist).
- **Pose values are semantic, not raw rotations.** Each bone has up to three degrees of freedom
  (DOFs) stored as signed degrees `[flex, twist, side]` whose anatomical meaning is identical for the
  left and right side (§7.4). Mirroring a pose is therefore a plain copy between sides, and presets,
  sliders and limits are all expressed in anatomical terms. The renderer converts semantic values
  into local three.js rotations (axis + sign per bone and side) in exactly one place
  (`src/lib/mannequin/rom.ts`), covered by "semantic" unit tests (e.g., *left knee flexion moves the
  left ankle backward*).

### 7.2 Range-of-motion table (degrees, from neutral)

Values are rounded typical ranges for a healthy adult (based on common clinical norms such as
AAOS), slightly extended where weight-bearing poses (squat, kneel, push-up) need it. They may be
fine-tuned during implementation, but **any change must be reflected in this table**.

| Region | Bone (`left*`/`right*` per side) | Moves | Motions → range |
|---|---|---|---|
| Root | `hips` | Whole figure | Free position & rotation (figure placement; not limited) |
| Torso | `spine` | Abdomen and everything above | Flexion 0–45 · Extension 0–20 · Lateral bend ±20 · Twist ±15 |
| Torso | `chest` | Chest and everything above | Flexion 0–35 · Extension 0–10 · Lateral bend ±15 · Twist ±30 |
| Head | `neck` | Neck and head | Flexion 0–35 · Extension 0–40 · Lateral bend ±30 · Twist ±50 |
| Head | `head` | Head | Flexion (nod) 0–20 · Extension 0–25 · Lateral tilt ±15 · Twist ±30 |
| Arm | `*Shoulder` | Clavicle / shoulder girdle | Elevation (shrug) 0–30 · Depression 0–10 · Protraction 0–20 · Retraction 0–20 |
| Arm | `*UpperArm` | Upper arm (shoulder joint) | Flexion 0–180 · Extension 0–60 · Abduction 0–180 · Adduction 0–45 · Internal rotation 0–80 · External rotation 0–90 |
| Arm | `*LowerArm` | Forearm (elbow + forearm twist) | Flexion 0–150 · Hyperextension 0–5 · Pronation 0–85 · Supination 0–85 |
| Arm | `*Hand` | Hand (wrist) | Flexion 0–80 · Extension 0–80 · Radial deviation 0–20 · Ulnar deviation 0–35 |
| Thumb | `*ThumbMetacarpal` | Thumb base (CMC) | Flexion 0–45 · Extension 0–25 · Palmar abduction 0–70 · Adduction 0–10 · Opposition twist 0–45 |
| Thumb | `*ThumbProximal` | Thumb MCP | Flexion 0–60 · Hyperextension 0–10 |
| Thumb | `*ThumbDistal` | Thumb IP | Flexion 0–80 · Hyperextension 0–20 |
| Fingers | `*{Index,Middle,Ring,Little}Proximal` | Knuckle (MCP) | Flexion 0–90 · Hyperextension 0–30 · Spread ±20 |
| Fingers | `*{Index,Middle,Ring,Little}Intermediate` | Middle joint (PIP) | Flexion 0–110 |
| Fingers | `*{Index,Middle,Ring,Little}Distal` | Tip joint (DIP) | Flexion 0–80 · Hyperextension 0–10 |
| Leg | `*UpperLeg` | Thigh (hip joint) | Flexion 0–130 · Extension 0–30 · Abduction 0–45 · Adduction 0–30 · Internal rotation 0–40 · External rotation 0–45 |
| Leg | `*LowerLeg` | Shin (knee) | Flexion 0–155 · Hyperextension 0–5 |
| Leg | `*Foot` | Foot (ankle) | Dorsiflexion 0–30 · Plantarflexion 0–50 · Inversion 0–35 · Eversion 0–15 · Toe-in/out twist ±15 |
| Leg | `*Toes` | Toes (MTP) | Extension 0–60 · Flexion 0–40 |

Bone count: 5 (hips, spine, chest, neck, head) + 2 × [4 arm + 15 finger + 4 leg] = **51**.

Sanity checks against clinical norms: neck + head ≈ flexion 55° · extension 65° · lateral 45° ·
rotation 80°; spine + chest ≈ flexion 80° · extension 30° · lateral 35° · rotation 45°.

### 7.3 Bone → clickable segment mapping

| Clicked segment | Selected bone |
|---|---|
| Pelvis | `hips` (selects the whole figure; Move tool) |
| Abdomen | `spine` |
| Chest / ribcage | `chest` |
| Neck | `neck` |
| Head | `head` |
| Shoulder ball / clavicle area | `*Shoulder` |
| Upper arm | `*UpperArm` |
| Forearm | `*LowerArm` |
| Palm | `*Hand` |
| Finger / thumb segment | that segment's bone |
| Thigh | `*UpperLeg` |
| Shin | `*LowerLeg` |
| Foot | `*Foot` |
| Toes | `*Toes` |

### 7.4 Semantic DOF encoding — contract for poses, presets, sliders and limits

Pose arrays are `[flex, twist, side]` in degrees, relative to the neutral pose. Positive directions:

| Bone(s) | `flex` + / − | `twist` + / − | `side` + / − |
|---|---|---|---|
| `spine`, `chest`, `neck`, `head` | Bend forward / backward | Turn toward the figure's **left** / right | Bend toward the figure's **left** / right |
| `*Shoulder` | — (always 0) | Protraction / retraction | Elevation / depression |
| `*UpperArm` | Flexion / extension | Internal / external rotation | Abduction / adduction |
| `*LowerArm` | Flexion / hyperextension | Pronation / supination | — |
| `*Hand` | Flexion / extension | — | Radial / ulnar deviation |
| `*ThumbMetacarpal` | Flexion / extension | Opposition / — | Palmar abduction / adduction |
| `*ThumbProximal`, `*ThumbDistal` | Flexion / hyperextension | — | — |
| `*{Index,Middle,Ring,Little}Proximal` | Flexion / hyperextension | — | Spread away from the middle finger / toward it (middle finger: toward thumb / toward little finger) |
| `*{Index,Middle,Ring,Little}Intermediate`, `…Distal` | Flexion / hyperextension | — | — |
| `*UpperLeg` | Flexion / extension | Internal / external rotation | Abduction / adduction |
| `*LowerLeg` | Flexion / hyperextension | — | — |
| `*Foot` | Plantarflexion (point toes) / dorsiflexion | Toe-in / toe-out | Inversion / eversion |
| `*Toes` | Flexion (curl down) / extension (lift up) | — | — |

Signed limits `[min, max]` derived from §7.2 (— = locked at 0). Implementation must match exactly:

| Bone | `flex` | `twist` | `side` |
|---|---|---|---|
| `spine` | −20 … 45 | −15 … 15 | −20 … 20 |
| `chest` | −10 … 35 | −30 … 30 | −15 … 15 |
| `neck` | −40 … 35 | −50 … 50 | −30 … 30 |
| `head` | −25 … 20 | −30 … 30 | −15 … 15 |
| `*Shoulder` | — | −20 … 20 | −10 … 30 |
| `*UpperArm` | −60 … 180 | −90 … 80 | −45 … 180 |
| `*LowerArm` | −5 … 150 | −85 … 85 | — |
| `*Hand` | −80 … 80 | — | −35 … 20 |
| `*ThumbMetacarpal` | −25 … 45 | 0 … 45 | −10 … 70 |
| `*ThumbProximal` | −10 … 60 | — | — |
| `*ThumbDistal` | −20 … 80 | — | — |
| `*{Finger}Proximal` | −30 … 90 | — | −20 … 20 |
| `*{Finger}Intermediate` | 0 … 110 | — | — |
| `*{Finger}Distal` | −10 … 80 | — | — |
| `*UpperLeg` | −30 … 130 | −45 … 40 | −30 … 45 |
| `*LowerLeg` | −5 … 155 | — | — |
| `*Foot` | −30 … 50 | −15 … 15 | −15 … 35 |
| `*Toes` | −60 … 40 | — | — |

Figure placement (the `hips` root) uses the scene document's `transform` (ARCHITECTURE §8); pose
presets describe hips orientation semantically as `[pitch, yaw, roll]` degrees relative to upright
(pitch + = tip forward, yaw + = turn toward the figure's left, roll + = lean toward the figure's left).

## 8. Body presets & materials

### 8.1 Body presets

The presets let artists approximate *any* character at different ages and builds — for example the
same character at ≈10, ≈15 and ≈19 years old, or a short but very muscular adult — **without**
reproducing a specific copyrighted character (see §15).

| `presetId` | UI name | Height | Heads tall | Build notes | Default material | Priority |
|---|---|---|---|---|---|---|
| `classic-wooden` | Classic Wooden (default) | 1.75 m | 7.5 | Idealized neutral body, simple carved face, visible ball joints | Wood | P0 |
| `realistic-male` | Realistic Man | 1.78 m | 7.5 | Average adult male | Clay | P0 |
| `realistic-female` | Realistic Woman | 1.65 m | 7.5 | Average adult female (narrower shoulders, wider hips) | Clay | P0 |
| `anime-child` | Anime Child (~10 y) | 1.40 m | 5.5 | Slim, large head, short limbs, no muscle definition | Toon | P0 |
| `anime-teen-boy` | Anime Teen Boy (~15 y) | 1.68 m | 6.5 | Slim, slightly long legs, narrow shoulders | Toon | P0 |
| `anime-young-man` | Anime Young Man (~19 y) | 1.83 m | 7.5 | Athletic, broad shoulders, long legs | Toon | P0 |
| `anime-compact-adult` | Anime Compact Adult | 1.60 m | 7.0 | Short adult man, lean and very muscular, narrow waist | Toon | P0 |
| `anime-teen-girl` | Anime Teen Girl (~15 y) | 1.58 m | 6.5 | Slim, narrow shoulders | Toon | P1 |
| `anime-young-woman` | Anime Young Woman (~20 y) | 1.68 m | 7.5 | Long legs, narrow waist | Toon | P1 |
| `chibi` | Chibi | 0.90 m | 2.5 | Super-deformed, simplified hands | Toon | P2 |

Anime presets differ from realistic ones mainly in proportions: larger heads for younger ages,
longer legs (≈ 50–55 % of height) for teens/young adults, slimmer limbs, smaller hands/feet.
Every preset is a set of default values for the proportion sliders (F2), so users can fine-tune.

**Faces** (owner request, 2026-11-27; ARCHITECTURE ADR-061). Every preset carries a generic sculpted
face — never the likeness of a character (§15) — with a neutral expression, closed eyes (lid mounds
in the sockets) and a closed mouth. Male and female faces differ at drawing distance:

| Preset(s) | Face style | Reads as |
|---|---|---|
| `classic-wooden` | Neutral carved | Simplified carved face: brow ridge, sockets, wedge nose, simple closed lips; neither male nor female |
| `realistic-male` | Realistic male | Heavy, straight brow over deep, narrow sockets; long, wide nose with a strong bridge and wide nostrils; wide mouth, thin lips; broad jaw, square chin |
| `realistic-female` | Realistic female | Soft, arched brow; large almond eyes with a visible upper lid; small, narrow, upturned nose; full lips with a cupid's bow and a fuller lower lip; narrow jaw, soft chin |
| `anime-child` | Anime child | Rounder and softer: large shallow eye areas set low on the big cranium, features close together, button nose, tiny mouth, full cheeks |
| `anime-teen-boy`, `anime-young-man`, `anime-compact-adult` | Anime male (teen → young → mature) | Straight brow, narrower eye areas, a small sharp nose and a small thin-lipped mouth; brow, nose and chin grow stronger from the teen to the compact adult |
| `anime-teen-girl`, `anime-young-woman` | Anime female | Arched brow, large round eye areas, a tiny upturned nose, a tiny full mouth, a soft narrow chin |

The face is part of the head's geometry, so it follows the head-size and proportion sliders; custom
proportions keep their preset's face. Toon shading draws the faces' broad forms as clean cel shapes
plus the lines an illustrator would draw — the lid/lash line, the nostrils and the mouth line — so
anime faces read at drawing distance.

### 8.2 Materials

| Style | Look | Best for |
|---|---|---|
| Wood | Warm beige, subtle procedural grain, satin finish | Classic mannequin feel |
| Clay | Neutral mid-gray, matte | Value / form-shading studies |
| Toon | Cel-shaded (2–3 tone steps) + dark outline | Anime / manga look |
| Plaster | Off-white, matte | Strong cast-shadow studies |

Each figure has a style plus a tint color.

## 9. Lighting model (artist's view)

- **Key light (bulb)** — the main light; its position decides where the shadow side falls. Users drag
  it around the figure; brightness 0–100 %.
- **Additional bulbs** — fill or rim lights (up to 4 lights total).
- **Ambient fill** — uniform soft light; 0 % gives deep black shadows, higher values lift them.
- **Color temperature** — warm (2000 K, candle) to cool (10000 K, overcast sky).
- **Shadows** — each bulb can cast shadows; softness controls the shadow edge; global quality setting.
- Shadow casting is the expensive part of rendering; by default at most two lights cast shadows and
  a warning appears when more are enabled.
- Lighting presets (Studio, Rembrandt, Rim, Top, Under) are P2.

## 10. Lock behavior

| State | Canvas pointer on figure | Gizmos / IK handles | Pose panels & presets | Figure move | Bulb select/drag | Light panel | Camera |
|---|---|---|---|---|---|---|---|
| Unlocked | Select/rotate/drag | Shown | Editable | Allowed | Allowed | Editable | Free |
| **Pose locked** | Ignored (cursor `not-allowed`, tooltip "Pose locked") | Hidden | Read-only | Blocked | Allowed | Editable | Free |
| **Lights locked** | Normal | Shown | Editable | Allowed | Ignored | Read-only | Free |
| **Both locked** (pose + lights) | Ignored | Hidden | Read-only | Blocked | Ignored | Read-only | Free |
| **View locked** | Normal | Normal | Normal | Normal | Normal | Normal | **Frozen** (no orbit/zoom/pan, presets/frame/focal length/turntable disabled) |
| **Master lock** (pose + lights + view) | Ignored | Hidden | Read-only | Blocked | Ignored | Read-only | **Frozen** |
| Figure locked (per figure) | Ignored for that figure only | Hidden for that figure | Read-only for that figure | Blocked for that figure | — | — | Free |

Additional rules:
- Locking clears the current selection of locked items.
- Unlocking requires an explicit click/shortcut — a drag can never unlock.
- The toolbar shows a visible *Locked* badge; a toast confirms lock/unlock.
- Undo/redo of a locked item is still allowed only after unlocking (history entries that would
  modify locked items are skipped with a toast) — keeps the guarantee "locked = cannot change".
- Lock state is part of the saved workspace.

## 11. Accounts, workspaces & limits

- Authentication by email + password (hashed by the auth library); optional GitHub/Google.
- Sessions last 30 days, refreshed on activity; sign-out invalidates the session.
- Workspace quota: `MAX_WORKSPACES_PER_USER` (server configuration, **default 5**). The owner said
  "maximum 5 workspaces per user *for now*" — so the limit is a setting, not a hard-coded constant,
  and the API returns it to the UI.
- Workspace name: 1–60 characters (trimmed), default "Untitled workspace N".
- Per scene: ≤ 8 figures, ≤ 4 lights. Serialized scene ≤ 256 KB; thumbnail ≤ 300 KB.
- Deleting a workspace is permanent after confirmation (no trash in v1).
- Personal figure presets (F15): `MAX_PRESETS_PER_USER` (server configuration, **default 50**),
  returned by the API like the workspace quota; name 1–60 characters; a preset document ≤ 16 KB.
  Deleting a preset is permanent after confirmation; figures already made with it stay as they are.

## 12. Guest mode

- Anyone can open `/editor` without an account; the scene is kept as a browser draft (localStorage)
  and restored on the next visit to `/editor`.
- A banner explains "You're editing as a guest — Sign up to save up to 5 workspaces."
- **Save to cloud** → sign in/up → draft is created as a workspace → editor switches to
  `/editor/<workspaceId>`; the local draft is cleared after a successful upload.
- If the account is already at the limit, the user can replace an existing workspace or cancel.

## 13. UI / UX specification

### 13.1 Layout (editor, desktop ≥ 1280 px)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Logo · Workspace name ✎ · Save status │ Undo Redo │ 🔒 Lock ▾ │ Export │ User │
├──────────────┬────────────────────────────────────────────────┬────────────────┤
│ Tools        │                                                │ Properties     │
│  ◎ Rotate R  │                                                │ (contextual:   │
│  ✥ Drag  G   │               3D viewport                      │  bone / figure │
│  ⇔ Move  M   │   figures · bulbs · floor · gizmos             │  / light /     │
│──────────────│                                                │  scene)        │
│ Outliner     │                         ┌──────────┐           │────────────────│
│  Figure 1 🔒 │                         │ view cube│           │ Presets        │
│  Figure 2    │                         └──────────┘           │ (pose / hands  │
│  Key light   │                                                │  / body / mine)│
├──────────────┴────────────────────────────────────────────────┴────────────────┤
│ Status bar: selected bone · current angles · hint · Locked badge               │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Dark neutral UI so the figure stands out; one accent color; panels collapsible.
- Tablet (≥ 768 px): panels become drawers. Phone: viewing + presets only (best effort).
- Empty/edge states: limit reached, offline, save error, WebGL unavailable (friendly fallback).

### 13.2 Pages

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Landing page |
| `/sign-in`, `/sign-up` | Public (redirect to `/workspaces` when signed in) | Authentication |
| `/workspaces` | Signed in | Dashboard (max 5 cards) |
| `/editor` | Public | Guest editor (local draft) |
| `/editor/[workspaceId]` | Owner only | Editor bound to a cloud workspace |

### 13.3 Keyboard shortcuts

| Keys | Action |
|---|---|
| R / G / M | Rotate (FK) / Drag (IK) / Move tool |
| L | Toggle master lock (pose + lights + view) |
| V | Toggle view (camera) lock |
| Esc | Deselect / close dialog |
| F | Frame selection |
| 1 · 2 · 3 · 4 · 5 | Front · Back · Left · Right · Top view |
| T | Toggle turntable |
| Ctrl/Cmd + Z · Ctrl/Cmd + Shift + Z (or Ctrl + Y) | Undo · Redo |
| Ctrl/Cmd + S | Save now |
| Delete / Backspace | Delete selected figure or light (undoable) |
| Ctrl/Cmd + D | Duplicate selected figure |
| ? | Shortcut help |

Shortcuts are disabled while typing in inputs.

## 14. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | §3.3 targets; three.js is loaded only on editor routes; render on demand (no continuous rendering while idle). |
| Compatibility | Latest 2 versions of Chrome, Edge, Firefox, Safari with WebGL 2; graceful message when WebGL is unavailable. |
| Accessibility | WCAG 2.2 AA for all 2D UI: labels, focus order, visible focus, contrast; every pose change is also possible via sliders (non-pointer alternative); reduced-motion respected for camera animations. |
| Security | Hashed passwords, HttpOnly/Secure cookies, CSRF/origin checks, server-side authorization on every workspace access, input validation with size limits, auth rate limiting, security headers, no secrets in the repo. Details in ARCHITECTURE §13. |
| Reliability | Autosave with retry; unsaved-changes guard; scene documents are versioned and migrated on load; invalid stored data is repaired (clamped) instead of crashing the editor. |
| Maintainability | TypeScript strict, small modules, data-driven skeleton/ROM/presets, unit + E2E tests, living docs. |
| Observability | No console errors in normal use; server errors logged with request context (no PII); Vercel Analytics optional (P2). |
| SEO | Landing page: title, description, Open Graph image, sitemap/robots. |
| Internationalization | UI copy English in v1; strings kept in components in a way that a Vietnamese locale can be added later (P2). |

## 15. Content & intellectual-property policy

- Artikin ships **only original, generic content**: procedural mannequins, generic body presets,
  generic poses.
- **No copyrighted characters**: no names, likenesses, signature hairstyles, outfits or gear of
  characters from anime, manga, games or films (for example, characters from *Attack on Titan*)
  appear in code, assets, preset names or marketing. The owner's wish for "a character like Eren
  at different ages or Levi" is satisfied with **generic age/build presets** (§8.1) that artists can
  use to draw their own interpretations.
- Future user-imported avatars (roadmap: VRM) are private to the uploading user, never shared or
  showcased, and the user is responsible for having the rights to them.

## 16. Privacy & data handling

- Stored personal data: name, email, password hash, OAuth account links, session records (incl. IP
  address and user agent, as recorded by the auth library), the user's workspaces and their personal
  figure presets (body, proportion, material and pose values — no images, no model files).
- No advertising or third-party tracking cookies in v1; only the essential session cookie.
- Account deletion (cascade-deletes workspaces and presets) is P2; until then the owner can delete on
  request.

## 17. Assumptions & decisions taken during planning

| ID | Topic | Decision |
|---|---|---|
| A1 | Name | **Artikin** (artist + manikin). Folder `PJ_Per\artikin`. |
| A2 | Reference image | The image mentioned in the request was not received. The default figure follows the classic **wooden artist mannequin** (egg head, ball joints). It was faceless until the owner asked for faces (A12); it now has a simple, neutral carved face. |
| A3 | Anime characters | Specific copyrighted characters are **not** reproduced; replaced by generic anime age/build presets + toon material (§8, §15). |
| A4 | Workspace limit | Default 5, configurable (`MAX_WORKSPACES_PER_USER`). |
| A5 | Auth scope | Email/password + optional OAuth; no email verification / password reset in v1. |
| A6 | UI language | English in v1 (Vietnamese locale is a roadmap item). |
| A7 | Source control | Git repository initialized at the owner's request (2026-11-27). The remote is a repository on the owner's personal GitHub account, and commits use the owner's personal identity (repository-local git config). Agents never commit or push unless the owner explicitly asks. |
| A8 | Hosting | Vercel + Neon Postgres in production; local development needs no database install (embedded PGlite). |
| A9 | Device focus | Desktop/laptop with mouse first; touch is best effort. |
| A10 | ROM realism | Realistic limits by default; a "Flexible (athlete)" profile is a roadmap item. |
| A11 | Compliance | Personal project with strict rules: separation from any workplace code/data/accounts, localhost-only servers, no external services or account sign-ups by agents, permissive OSS licenses only, original assets only (rules in AGENTS.md → Compliance & safety). |
| A12 | Faces | Owner request (2026-11-27): "add a nose and eye sockets to the mannequin" and "also add lips; each existing model gets its own style of eye sockets, nose and mouth, for male and female models". Every body preset now has a generic sculpted face style (§8.1, ARCHITECTURE ADR-061): real relief geometry, neutral expression, eyes and mouth closed. Expressions, hair and clothing stay out of scope (§3.2); no character likeness (§15). |
| A13 | My presets (F15) | Owner feature of 2026-11-27, decisions by the supervisor: presets are stored per **account** in the database (every workspace and device), up to 50 per user (configurable); a preset always holds the body (base body preset, full proportions, material) and optionally the pose and hands; imported models, figure names, placement, heading, visibility and locks are never saved; the document is versioned (`version: 1`); the list loads on first need, saves are never automatic; no sharing, import/export or stored thumbnails. |

## 18. Roadmap & out of scope

| Version | Items |
|---|---|
| **v1 (this build)** | F1–F14 (P0 + P1); F15 My presets added on the owner's request (2026-11-27). |
| v1.1 | **Import your own model (VRM 1.0/0.x, Mixamo-style GLB)** — mapped through the VRM humanoid bones (1:1 with Artikin's bone names) so ROM limits, IK, lights and lock keep working; files stay **local to the browser** (IndexedDB), never uploaded or shared; the user must own the rights (e.g. models made with VRoid Studio or licensed by their author) — planned as the compliant answer to the owner's wish for character-like models (owner may redirect). Also: lighting presets; spot/sun lights; ROM profile *Flexible*; chibi preset; save custom poses per user (done early: F15 My presets saves body and pose); read-only share links; Vietnamese UI; password reset & email verification (email provider such as Resend); account deletion; optional original anime/tokusatsu-style accessory kit (generic hair, cloak, armor — no copied designs). |
| v2 | Props (chair, box, stick/sword); reference-image overlay; perspective/grid overlays for drawing; depth/normal/line-art export; mobile touch posing; collaboration. |

Out of scope for all planned versions: distributing copyrighted character models.

## 19. Open questions for the owner

1. Is the name **Artikin** OK?
2. Please re-send the reference image of the default mannequin (it did not come through) so the look
   can be fine-tuned.
3. Which OAuth providers are wanted (GitHub, Google, Discord, none)?
4. Is a Vietnamese UI needed in v1?
5. Custom domain for the Vercel deployment?

## 20. Definition of done (v1)

v1 is done when:
- All P0 and P1 acceptance criteria in §6 are met and verified (tests and/or screenshots).
- Release gate **G5** in [PROGRESS.md](./PROGRESS.md) is green: lint, typecheck, unit tests,
  production build and E2E tests pass; security/performance/accessibility reviews are recorded.
- README explains local setup and Vercel deployment; PROJECT/ARCHITECTURE/PROGRESS are up to date.
- Nothing has been committed or pushed (owner's decision).

## 21. Glossary

| Term | Meaning |
|---|---|
| Bone / joint | A rotatable part of the skeleton; a bone rotates around the joint at its base. |
| ROM | Range of motion — allowed rotation range of a joint. |
| FK | Forward kinematics — rotating joints directly (gizmo, sliders). |
| IK | Inverse kinematics — moving an end point (hand/foot) and solving the joint rotations. |
| Gizmo | On-canvas widget (rings/arrows) for rotating or moving the selected object. |
| Preset | Stored set of values: body proportions, full-body pose, or hand pose. |
| Scene document | Versioned JSON describing a whole scene; stored per workspace. |
| Workspace | A saved scene owned by a user (max 5 per user by default). |
| Toon shading | Cel-shaded rendering with hard light/shadow steps, typical for anime. |
| Heads tall | Figure height expressed in head heights (artistic proportion unit). |
| Guest draft | Unsaved scene stored in the browser for users without an account. |
