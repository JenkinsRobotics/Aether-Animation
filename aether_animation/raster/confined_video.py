"""One-frame video adapter for hosted previews; accepts only staged asset bytes.

FFmpeg's fd protocol reads a seekable, inherited descriptor. Network and file
protocols are disabled even inside a container. No source name becomes an argv
path or URL. See https://ffmpeg.org/ffmpeg-protocols.html#fd .
"""

import os
import subprocess
from pathlib import Path

from aether_animation.raster.frame import FrameBuffer


def _limits():
    # This subprocess is launched by the single-threaded installed worker.
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


class ConfinedVideo:
    def open(self, asset_path, *, width, height, params):
        self.path = Path(asset_path)
        self.width, self.height = width, height
        self.loop = params.get("loop", True)

    def close(self):
        pass

    def next_frame(self, t):
        import imageio_ffmpeg

        # Explicit demuxer selection refuses playlists and nested archive formats.
        # Unbuffered: the inherited descriptor must really be rewound after sniffing.
        with self.path.open("rb", buffering=0) as media:
            header = media.read(16)
            media.seek(0)
            if header[4:8] == b"ftyp":
                demuxer = "mov"
            elif header.startswith(b"\x1aE\xdf\xa3"):
                demuxer = "matroska"
            elif header.startswith(b"RIFF") and header[8:12] == b"AVI ":
                demuxer = "avi"
            else:
                raise ValueError(
                    "Hosted video requires a self-contained MP4, WebM or AVI."
                )
            args = [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-max_alloc",
                "67108864",
                "-threads",
                "1",
                "-filter_threads",
                "1",
                "-protocol_whitelist",
                "fd",
                "-fd",
                "0",
                "-f",
                demuxer,
                "-max_pixels",
                "16777216",
                "-probesize",
                "2097152",
                "-analyzeduration",
                "1000000",
            ]
            if demuxer == "mov":
                args += ["-enable_drefs", "0", "-use_absolute_path", "0"]
            if self.loop:
                args += ["-stream_loop", "-1"]
            args += [
                "-i",
                "fd:",
                "-ss",
                str(max(0.0, t)),
                "-map",
                "0:v:0",
                "-an",
                "-sn",
                "-dn",
                "-frames:v",
                "1",
                "-vf",
                f"scale={self.width}:{self.height}",
                "-threads",
                "1",
                "-pix_fmt",
                "rgba",
                "-f",
                "rawvideo",
                "pipe:1",
            ]
            # At most one known-size raw frame; diagnostic output is discarded,
            # so corrupt metadata cannot grow an unbounded captured stderr.
            result = subprocess.run(
                args,
                stdin=media,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=6,
                check=False,
                preexec_fn=_limits if os.name == "posix" else None,
            )
        if result.returncode:
            raise ValueError("Video decoding failed or exceeded its resource limit.")
        if not result.stdout:
            return None  # Non-looping source after its final frame.
        return FrameBuffer(width=self.width, height=self.height, data=result.stdout)
