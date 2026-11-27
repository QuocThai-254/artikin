# Sculpted faces (S2, ADR-061, VIS-09)

Owner request (2026-11-27): a nose, eye sockets and lips on the mannequin, with its own style of
eye sockets, nose and mouth per existing model, for male and female models (PROJECT §8.1, A12).

Captured from the editor (`/editor`, production build on localhost) with Playwright's bundled
Chromium headless shell on the D3D11 WARP software rasterizer, 1280 × 800, DSF 1: a guest draft per
cell with one body preset, a 150 mm lens on the head and the scene's single bulb placed to the upper
left of each view (45° key, intensity 32 %, ambient 25 %, shadows on). Each cell is a 540 px crop of
the canvas centre, scaled into the sheet. All geometry is procedural (original), generic types only.

| File | Shows |
|---|---|
| `faces-front.png` | All 9 body presets, front view, each in its default material (wood, clay, toon) |
| `faces-three-quarter.png` | The same, ¾ view |
| `faces-profile.png` | The same, profile |
| `faces-materials.png` | Classic Wooden, Realistic Woman and Anime Young Man in wood, clay, plaster and toon (¾) |

Face style per preset (`src/lib/mannequin/mesh/face.ts`):

| Preset | Style |
|---|---|
| Classic Wooden | Neutral carved |
| Realistic Man | Realistic male — heavy straight brow, deep narrow sockets, long wide nose, wide thin mouth, square chin |
| Realistic Woman | Realistic female — arched brow, almond eyes with a visible lid, small upturned nose, full lips with a cupid's bow, soft chin |
| Anime Child | Child — big low eye areas, button nose, tiny mouth, full cheeks |
| Anime Teen Boy / Young Man / Compact Adult | Anime male, teen → young → mature |
| Anime Teen Girl / Young Woman | Anime female |
