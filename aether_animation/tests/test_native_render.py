"""Actual hosted decoders, bounds and immutable authoring state."""

import base64
import copy
import io
import json
import subprocess

import pytest
from PIL import Image

from aether_animation.native_render import render_request


def image_bytes(format="PNG", frames=None, size=(16, 16)):
    images = [Image.new("RGB", size, color) for color in (frames or ["red"])]
    out = io.BytesIO()
    options = (
        {"save_all": True, "append_images": images[1:], "duration": 100}
        if len(images) > 1
        else {}
    )
    images[0].save(out, format=format, **options)
    return out.getvalue()


def request(kind="image", data=None, **params):
    source = {"id": "s", "kind": kind, "asset": "private/media"}
    if kind == "procedural":
        source["asset"] = "simple"
    canvas = {
        "width": 16,
        "height": 16,
        "sources": [source],
        "surfaces": [{"id": "s", "source": "s"}],
    }
    return {
        "id": 7,
        "method": "canvas2d.matrix_preview",
        "params": {
            "studio_canvas": canvas,
            "studio_assets": {
                "private/media": base64.b64encode(data or image_bytes()).decode()
            },
            "target": {"width": 1, "height": 1},
            **params,
        },
    }


def pixel(req):
    result = render_request(req)
    assert result["ok"], result
    return tuple(result["result"]["rows"][0][0])


@pytest.mark.parametrize("format", ["PNG", "JPEG", "BMP", "WEBP"])
def test_real_images_keep_source_unchanged_and_produce_png(format):
    req = request(data=image_bytes(format))
    original = copy.deepcopy(req)
    color = pixel(req)
    assert color[0] >= 250 and color[1] <= 3 and color[2] <= 3
    req["method"] = "canvas2d.render_frame"
    result = render_request(req)
    png = base64.b64decode(result["result"]["png_base64"])
    with Image.open(io.BytesIO(png)) as img:
        assert img.size == (16, 16) and img.getpixel((8, 8))[0] >= 250
    assert req["params"] == original["params"]


def test_gif_clock_loop_and_end_and_bitmap():
    data = image_bytes("GIF", ["red", "lime"])
    assert pixel(request("gif", data, time_seconds=0.15)) == (0, 255, 0)
    assert pixel(request("gif", data, time_seconds=0.25)) == (255, 0, 0)
    req = request("gif", data, time_seconds=0.25)
    req["params"]["studio_canvas"]["sources"][0]["loop"] = False
    assert pixel(req) == (0, 0, 0)
    bitmap = json.dumps({"width": 16, "height": 16, "data": [255] * 32}).encode()
    assert pixel(request("bitmap", bitmap)) == (255, 255, 255)


def test_sprite_driver_and_procedural_and_layer_composition():
    sheet = Image.new("RGB", (32, 16), "red")
    sheet.paste(Image.new("RGB", (16, 16), "lime"), (16, 0))
    out = io.BytesIO()
    sheet.save(out, format="PNG")
    req = request("sprite", out.getvalue(), values={"frame": 1})
    req["params"]["studio_canvas"]["sources"][0].update(columns=2, frame_count=2)
    surface = req["params"]["studio_canvas"]["surfaces"][0]
    surface["drivers"] = [{"property": "frame", "source": "frame"}]
    assert pixel(req) == (0, 255, 0)
    assert sum(pixel(request("procedural"))) > 0
    req = request()
    req["params"]["studio_canvas"]["surfaces"][0]["opacity"] = 0.5
    assert pixel(req) == (127, 0, 0)


@pytest.mark.parametrize(
    "container,codec", [("mp4", "libx264"), ("webm", "libvpx"), ("avi", "mpeg4")]
)
def test_video_descriptor_decoder_clock_loop_and_end(tmp_path, container, codec):
    import imageio_ffmpeg

    path = tmp_path / ("media." + container)
    raw = b"".join(Image.new("RGB", (16, 16), c).tobytes() for c in ("red", "lime"))
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            "16x16",
            "-r",
            "10",
            "-i",
            "pipe:0",
            "-c:v",
            codec,
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        input=raw,
        check=True,
        timeout=10,
    )
    req = request("video", path.read_bytes(), time_seconds=0.1)
    color = pixel(req)
    assert color[1] > 240 and color[0] < 8 and color[2] < 8
    req["params"]["time_seconds"] = 0.2
    color = pixel(req)
    assert color[0] > 240 and color[1] < 8
    req["params"]["studio_canvas"]["sources"][0]["loop"] = False
    assert pixel(req) == (0, 0, 0)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p["studio_canvas"].update(width=1000000),
        lambda p: p["studio_canvas"]["surfaces"][0].update(width=1e6),
        lambda p: p["studio_canvas"]["surfaces"][0].update(
            drivers=[{"property": "width", "source": "v", "output_at_zero": 1e6}]
        ),
        lambda p: p.update(time_seconds=float("nan")),
        lambda p: p.update(values={"v": float("inf")}),
        lambda p: p.update(target={"width": 1000000}),
        lambda p: p.update(studio_assets={}),
        lambda p: p.update(studio_assets={"private/media": "!bad"}),
        lambda p: p.update(studio_assets={"private/media": "A" * (3 * 1024 * 1024)}),
        lambda p: p["studio_canvas"]["sources"][0].update(asset="/etc/passwd"),
        lambda p: p["studio_canvas"]["sources"][0].update(
            asset="http://127.0.0.1/private"
        ),
    ],
)
def test_bad_input_is_rejected_without_file_or_network_access(mutate):
    req = request(values={"v": 0})
    mutate(req["params"])
    result = render_request(req)
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_media"
    assert "/etc" not in str(result) and "http:" not in str(result)


def test_large_decoded_image_gif_and_non_media_are_refused():
    for data, kind in [
        (image_bytes(size=(8192, 4096)), "image"),
        (image_bytes("GIF", ["red", "lime"], size=(4096, 4096)), "gif"),
        (b"%!PS-Adobe-3.0\nshowpage", "image"),
        (b"#EXTM3U\nhttp://127.0.0.1/private.mp4", "video"),
        (b"not a video", "video"),
    ]:
        assert render_request(request(kind, data))["ok"] is False
