"""The built-in adapter registry — one factory per source kind.

Wiring only: maps each ``SourceKind`` to the adapter class that decodes it. New
media kinds are one import + one ``register`` line here, never a branch in the
compositor.
"""

from __future__ import annotations

from aether_animation.canvas2d import SourceKind
from aether_animation.raster.base import AdapterRegistry
from aether_animation.raster.bitmap_adapter import BitmapAdapter
from aether_animation.raster.gif_adapter import GifAdapter
from aether_animation.raster.image_adapter import ImageAdapter
from aether_animation.raster.procedural import ProceduralAdapter, default_faces
from aether_animation.raster.sprite_adapter import SpriteAdapter
from aether_animation.raster.video_adapter import VideoAdapter

__all__ = ["default_registry"]


def default_registry() -> AdapterRegistry:
    """A registry wired with every built-in decoder."""
    registry = AdapterRegistry()
    registry.register(SourceKind.IMAGE, ImageAdapter)
    registry.register(SourceKind.BITMAP, BitmapAdapter)
    registry.register(SourceKind.SPRITE, SpriteAdapter)
    registry.register(SourceKind.GIF, GifAdapter)
    registry.register(SourceKind.VIDEO, VideoAdapter)
    faces = default_faces()  # shared across surfaces (faces are stateless)
    registry.register(SourceKind.PROCEDURAL, lambda: ProceduralAdapter(faces))
    return registry
