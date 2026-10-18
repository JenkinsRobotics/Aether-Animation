"""Build the operator-installed immutable Animation worker archive."""

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--python", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
archive = args.output / "animation-worker.pyz"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    package.writestr(
        "__main__.py", "from aether_animation.native_worker import main\nmain()\n"
    )
    for path in sorted((root / "aether_animation").rglob("*.py")):
        if "tests" not in path.parts:
            package.write(path, str(path.relative_to(root)))
config = {
    "schema": 1,
    "python": str(args.python.absolute()),
    "archive": str(archive.absolute()),
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "max_sessions": 8,
}
(args.output / "native-animation.json").write_text(json.dumps(config, indent=2))
print("Built Animation worker and operator configuration.")
