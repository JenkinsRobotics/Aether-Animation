# Import unit fixtures

Salvaged from the native Swift app's `RealityKitViewportTests/Fixtures` when
that tree was removed on 2026-09-23 (it is in git history before that commit).
They are the inputs its model importer's unit handling was tested with, kept
for whichever side gains model import for Aether Animation (aether_animation or the
web app's importer). Not wired to a test yet.

| File | Authored units | The native test expected |
|---|---|---|
| `MillimeterTriangle.stl` | millimetres | `unitScaleToMeters` 0.001 |
| `CentimeterTriangle.obj` | centimetres | `unitScaleToMeters` 0.01 |
| `SimpleRobot.usda` | metres | loads; an entity named `Body` is present |
