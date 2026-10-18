# Aether Animation

The Aether ecosystem's unified motion, avatars, and animatronics product:
import a character, define its movable structure, animate it on a timeline,
preview it, and route the same evaluated trajectories to physical hardware.
It also maps face/body performance capture to 2D and 3D avatar blendshapes and
supports real-time puppetry.

## Current reality

The product is being REBUILT as a web app (per Jonathan, 2026-08-01):

- `web/` — the Aether Animation React app: `@aether/ui` widgets + a
  persistent Three.js viewport, driving the canonical Python engine over
  the aether_animation HTTP bridge (`python -m aether_animation.httpbridge`). The
  engine stays the single semantic authority; the app is chrome.
- The previous Swift application (`swift-app/`) and its native engine seam
  (`AetherKit/`) were archived under `archive/` on 2026-08-01 and removed
  from the tree on 2026-09-23; git history keeps them. A native Swift shell
  remains a future option; it would re-consume the same tokens
  (`core/ui/tokens/tokens.json`) and engine.

The Python semantics engine remains at `/aether_animation/` (canonical) until its
move into Core is scheduled.

Product-specific = timelines, show control, performance capture, avatar and
blendshape mapping, character-library UX, hardware panels, output buses, and
raw device adapters. This product's mathematical state and evaluation belong in
`aether_animation/` (Python), its own engine. `Aether CAD/aether-engine/` is the CAD
product's engine — do not import it here; genuinely shared presentation lives
in `core/ui/`.


## Current launcher and shared interface

Open **Aether Animation.app** at the repository root. It now uses the shared
Studio theme, WorkspaceShell and camera ViewCube in `core/ui/`. The prior native
**Anima Studio.app** was removed from the tree on 2026-09-23 (git history keeps it).
The web port is not yet full native-feature parity; the remaining workflow and
mockup-retirement gates are in
[`Aether_Studio_UI_Convergence.md`](../dev/docs/roadmap/Aether_Studio_UI_Convergence.md).
