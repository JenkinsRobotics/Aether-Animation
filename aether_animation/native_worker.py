"""Bounded stdio session for the native Studio host; engine semantics stay here.

The host owns files and credentials. This worker accepts in-memory authoring and
returns workspace bytes for guarded Studio saves. Media rendering uses a
confined byte adapter; no request grants access to a host filesystem path.
"""

import json
import sys
from pathlib import Path

from aether_animation.bridge import CAPABILITIES, Session, handle_request
from aether_animation.native_render import LIMITS, METHODS, render_request

MAX_LINE = 4 * 1024 * 1024
MAX_SESSION_INPUT = 64 * 1024 * 1024
UNAVAILABLE = {"shutdown"}


def main():
    session = Session(workspace_root=Path.cwd())
    consumed = 0
    while True:
        line = sys.stdin.buffer.readline(MAX_LINE + 1)
        if not line:
            return
        if len(line) > MAX_LINE:
            return
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                return
            method, params = request.get("method"), request.get("params") or {}
            if not isinstance(params, dict):
                return
            # Render bytes are transient, unlike commands that can grow retained
            # engine documents. Repeated previews must not exhaust a session.
            if method not in METHODS:
                consumed += len(line)
            if consumed > MAX_SESSION_INPUT:
                return
            if (
                method in UNAVAILABLE
                or method == "load_workspace"
                and not params.get("data_base64")
                or method == "save_workspace"
                and params.get("return_data") is not True
            ):
                result = {
                    "id": request.get("id"),
                    "ok": False,
                    "error": {
                        "code": "unsupported",
                        "message": "Use Studio document bytes; this worker cannot access server files or output devices.",
                    },
                }
            elif sum(
                len(getattr(session, name))
                for name in ["_rigs", "_canvases", "_workspaces"]
            ) >= 128 and method in {
                "load_character",
                "canvas2d.new",
                "canvas2d.load",
                "new_workspace",
                "load_workspace",
            }:
                result = {
                    "id": request.get("id"),
                    "ok": False,
                    "error": {
                        "code": "busy",
                        "message": "Release unused engine handles before loading more documents.",
                    },
                }
            elif method in METHODS:
                result = render_request(request)
            else:
                result = handle_request(session, request)
                if method == "hello" and result.get("ok"):
                    result["result"]["capabilities"] = [
                        value for value in CAPABILITIES if value not in UNAVAILABLE
                    ]
                    result["result"]["workspace_io"] = "studio_document_bytes"
                    result["result"]["media_limits"] = LIMITS
            encoded = json.dumps(result, allow_nan=False).encode() + b"\n"
            if len(encoded) > 16 * 1024 * 1024:
                return
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()
        except (ValueError, TypeError):
            return


if __name__ == "__main__":
    main()
