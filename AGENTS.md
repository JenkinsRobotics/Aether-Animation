## GitHub checkout handoff — 2026-10-10

Active development is now in `Aether-Animation`. The existing app snapshot was
imported from `Temp Aether` into this GitHub-linked checkout. Source history and
original starter files are preserved there; this checkout keeps its GitHub
history and origin. No upload or running-installation cutover was performed.
Studio (server, Drive and shared packages) lives in `../AetherStudio`.
Earlier migration notes below describe historical folder names.

# aether-animation contributor contract

## Product ownership — Jonathan, 2026-10-13

This single application repository owns its engine, document model, validated
command API, UI and product-specific MCP/CLI tools. Keep them as internal modules
or packages. Browser, desktop and headless execution reuse the same product
through runtime adapters, rather than separate products or repositories. UI and
agent access must converge on the same validated product operations.

Studio owns PDM/Drive, identity, permissions, centralized files, durable revisions,
releases and collaboration. Standalone apps retain local files, undo/redo and
recovery without a Studio database. Shared UI/artwork/protocol packages remain
versioned dependencies; product editing semantics stay here. This is the ownership
and implementation target, not a claim of completed offline or agent coverage.
See `../AetherStudio/dev/docs/roadmap/Aether_Architecture_Integration.md` for the
approved boundaries and gates. Existing engine and shared-package rules below
remain in force. Do not create separate engine, UI or MCP repositories for this app.

This is the product's new local development home. The previous monorepo is
retained for historical reference and the currently running deployment. Make new
changes here; do not edit both copies. Local migration evidence and suite setup
are in `../AetherStudio/migration/` and `../AetherStudio/suite.py`.
Read `SOURCE_HISTORY.json` for preserved ancestry. The GitHub origin is configured; see SOURCE_HISTORY.json.

- This product owns its domain engine, document meaning, UI, and runtime adapters.
- Consume shared UI/artwork/session/sketch as versioned packages; do not import a
  sibling project's source or copy shared icon geometry.
- CAD's parked `@aether/core` belongs exclusively to CAD. New parametric features
  use its FreeCAD adapter; read its ATTRIBUTION.md before changing it.
- Animation semantics belong to `aether_animation`, not the UI or renderer.
- Shared UI must not import a product engine or implement network transport.
- Keep original artwork and third-party attribution. Never overwrite branding/originals.
- Test changes in the owning project and record remaining limitations honestly.

Original architecture contracts are preserved in the original Aether Studio
checkout. Web frontends remain React/TypeScript. Native desktop packaging is
planned; this extraction does not add Tauri or replace engines with Rust.
