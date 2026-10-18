"""Canonical relation vocabulary, independent of numerical playback dependencies."""

from enum import StrEnum

from .mates import DofKind


class RelationKind(StrEnum):
    """The four linear DOF couplings (Kinematics.md §5)."""

    GEAR = "gear"
    RACK_PINION = "rack_pinion"
    SCREW = "screw"
    LINEAR = "linear"


# Each relation kind DEFINES its (driver kind, driven kind) pairing.
RELATION_KIND_DOF_KINDS: dict[RelationKind, tuple[DofKind, DofKind]] = {
    RelationKind.GEAR: (DofKind.ROTATION, DofKind.ROTATION),
    RelationKind.RACK_PINION: (DofKind.ROTATION, DofKind.TRANSLATION),
    RelationKind.SCREW: (DofKind.ROTATION, DofKind.TRANSLATION),
    RelationKind.LINEAR: (DofKind.TRANSLATION, DofKind.TRANSLATION),
}

