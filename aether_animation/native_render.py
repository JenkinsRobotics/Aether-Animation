"""Confined media adapter for the native host, using the canonical compositor.

Studio resolves private asset names and passes bytes with a canvas snapshot.
No model source is changed, no user path is opened, and every temporary decode
is bounded before invoking the existing raster adapters.
"""

import base64
import io
import json
import math
import subprocess
import tempfile
from dataclasses import replace
from pathlib import Path

from aether_animation.canvas2d import SourceKind, evaluate_surfaces
from aether_animation.canvas2d_io import canvas2d_from_mapping

MAX_ASSET_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 2 * 1024 * 1024
MAX_DECODE_PIXELS = 16 * 1024 * 1024
METHODS = {"canvas2d.render_frame", "canvas2d.matrix_preview"}
LIMITS = {
    "asset_scope": "private_user",
    "max_asset_bytes": MAX_ASSET_BYTES,
    "max_canvas_pixels": MAX_PIXELS,
    "max_surfaces": 32,
    "max_matrix_source_pixels": 262144,
    "max_matrix_pixels": 65536,
    "video_containers": ["mp4", "webm", "avi"],
}


def _size(width, height, limit=MAX_PIXELS):
    if not (1 <= width <= 8192 and 1 <= height <= 8192 and width * height <= limit):
        raise ValueError("Preview dimensions exceed the decoded-pixel limit.")
    return width * height


def _number(value):
    value = float(value)
    if not math.isfinite(value) or abs(value) > 1e9:
        raise ValueError("Preview values must be finite and bounded.")
    return value


def _image_cost(data, kind, target_pixels, instances):
    from PIL import Image

    # Restrict Pillow plugins: no EPS/Ghostscript, document or URL adapters.
    try:
        img = Image.open(
            io.BytesIO(data), formats=["PNG", "JPEG", "GIF", "BMP", "WEBP"]
        )
    except Image.DecompressionBombError as error:
        raise ValueError("Image exceeds the decoded-pixel limit.") from error
    with img:
        pixels = _size(*img.size, MAX_DECODE_PIXELS)
        count = getattr(img, "n_frames", 1) if kind == SourceKind.GIF else 1
        if count > 256:
            raise ValueError("Animated image exceeds 256 frames.")
        cost = (pixels * instances + target_pixels) * count
        if cost > MAX_DECODE_PIXELS:
            raise ValueError("Animated image exceeds the decoded-pixel budget.")
        # Validate all frame dimensions before the existing adapter caches them.
        for index in range(count):
            img.seek(index)
            _size(*img.size, pixels)
        return cost


def _bitmap_cost(data, target_pixels):
    value = json.loads(data)
    pixels = _size(int(value["width"]), int(value["height"]), MAX_DECODE_PIXELS)
    if not isinstance(value["data"], list) or any(
        type(x) is not int or not 0 <= x <= 255 for x in value["data"]
    ):
        raise ValueError("Invalid packed bitmap.")
    return pixels + target_pixels


def _render(method, params):
    from aether_animation.frame_output import LedMatrixTarget, downsample_canvas
    from aether_animation.raster.confined_video import ConfinedVideo
    from aether_animation.raster.gif_adapter import GifAdapter
    from aether_animation.raster.player import CanvasPlayer
    from aether_animation.raster.registry import default_registry

    canvas = canvas2d_from_mapping(params["studio_canvas"])
    pixels = _size(canvas.width, canvas.height)
    if len(canvas.surfaces) > 32 or len(canvas.sources) > 128:
        raise ValueError("Preview has too many surfaces or sources.")
    values = {str(k): _number(v) for k, v in params.get("values", {}).items()}
    t = _number(params.get("time_seconds", 0))
    target = None
    if method == "canvas2d.matrix_preview":
        dto = params.get("target") or {}
        target = LedMatrixTarget(
            width=int(dto.get("width", 64)),
            height=int(dto.get("height", 64)),
            gamma=_number(dto.get("gamma", 1)),
            brightness=_number(dto.get("brightness", 1)),
        )
        _size(target.width, target.height, 65536)
        _size(canvas.width, canvas.height, 262144)
    costs = {}
    total = pixels
    # Validate both initial adapter size and driven compositor size before any
    # decoder can allocate either one. Evaluation remains the engine's job.
    states = evaluate_surfaces(canvas, values, t)
    for state in (*canvas.surfaces, *states):
        for attr in ("x", "y", "width", "height", "rotation_deg", "opacity"):
            _number(getattr(state, attr))
        area = _size(
            max(1, round(state.width * canvas.width)),
            max(1, round(state.height * canvas.height)),
        )
        total += area
        costs[state.source] = costs.get(state.source, 0) + area
    if total > MAX_DECODE_PIXELS:
        raise ValueError("Surface allocation exceeds preview budget.")
    encoded = params.get("studio_assets", {})
    if not isinstance(encoded, dict) or sum(len(v) for v in encoded.values()) > (
        MAX_ASSET_BYTES * 4 // 3 + 128
    ):
        raise ValueError("Preview asset bytes exceed the limit.")
    assets = {k: base64.b64decode(v, validate=True) for k, v in encoded.items()}
    if sum(map(len, assets.values())) > MAX_ASSET_BYTES:
        raise ValueError("Preview asset bytes exceed the limit.")
    registry = default_registry()
    registry.register(SourceKind.VIDEO, ConfinedVideo)

    class PreviewGif(GifAdapter):
        def open(self, *args, **kwargs):
            super().open(*args, **kwargs)
            # A one-shot preview's clock is relative to the source start.
            self._start_time = 0.0

    registry.register(SourceKind.GIF, PreviewGif)
    with tempfile.TemporaryDirectory(prefix="render-") as folder:
        sources = {}
        for index, source in enumerate(canvas.sources.values()):
            if source.id not in costs:
                continue
            if source.kind == SourceKind.PROCEDURAL:
                sources[source.id] = source
                continue
            data = assets[source.asset]  # Opaque lookup only, never a filesystem path.
            if source.kind == SourceKind.BITMAP:
                cost = _bitmap_cost(data, costs[source.id])
            elif source.kind == SourceKind.VIDEO:
                cost = costs[source.id]
            else:
                instances = sum(s.source == source.id for s in canvas.surfaces)
                cost = _image_cost(data, source.kind, costs[source.id], instances)
            total += cost
            if total > MAX_DECODE_PIXELS:
                raise ValueError("Combined media exceeds the decoded-pixel budget.")
            path = Path(folder) / f"{index}.media"
            path.write_bytes(data)
            sources[source.id] = replace(source, asset=str(path))
        temporary = replace(canvas, sources=sources)
        # close also on a partial open failure, unlike __enter__ alone.
        player = CanvasPlayer(temporary, registry)
        try:
            player.open()
            frame = player.frame(values, t)
        finally:
            player.close()
    if target is not None:
        rows = downsample_canvas(frame.to_rgb_rows(), target)
        return {"width": target.width, "height": target.height, "rows": rows}
    buffer = io.BytesIO()
    frame.to_pil().convert("RGB").save(buffer, format="PNG")
    return {
        "width": frame.width,
        "height": frame.height,
        "png_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }


def render_request(request):
    try:
        result = _render(request["method"], request.get("params") or {})
        return {"id": request.get("id"), "ok": True, "result": result}
    except ImportError:
        code, message = (
            "media_unavailable",
            "Install the Animation media runtime to render previews.",
        )
    except subprocess.TimeoutExpired:
        code, message = "media_limit", "Video preview exceeded its decode deadline."
    except (
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        OSError,
        OverflowError,
        EOFError,
    ):
        # Do not reflect host paths or codec diagnostics to the client.
        code, message = (
            "invalid_media",
            "Invalid media, missing asset, or preview resource limit exceeded.",
        )
    return {
        "id": request.get("id"),
        "ok": False,
        "error": {"code": code, "message": message},
    }
