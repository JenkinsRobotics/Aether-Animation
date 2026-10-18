"""Animation runtime adapter for the Aether platform."""
from pathlib import Path
import shutil
import time
from core.host.state import Problem
from .bridge import Session, handle_request

class AnimationService:
    app = "animation"
    def rpc(self, host, user, app, token, data):
        store = host.store
        root = host.root_for(user["id"])
        if data.get("method") == "shutdown":
            raise Problem(403, "Engine shutdown is managed by the host.")

        key = (store.token_hash(token), app)

        if key not in host.engines:
            live = {
                r[0]
                for r in store.db.execute(
                    "SELECT token FROM sessions WHERE expires>? UNION SELECT token FROM services WHERE expires>? AND active=1",
                    (time.time(), time.time()),
                )
            }
            host.engines = {k: v for k, v in host.engines.items() if k[0] in live}
            host.engines[key] = Session(workspace_root=root)

        return handle_request(host.engines[key], data)


    def api(self, host, user, path, data):
        raise Problem(404, "Unknown Animation endpoint.")

    def seed_workspace(self, root):
        source = Path(__file__).resolve().parents[1] / "examples"
        target = root / "examples"
        target.mkdir(exist_ok=True)
        sample = source / "pan_tilt_head.character.anima"
        if sample.is_file():
            shutil.copy2(sample, target / sample.name)
            for name in ("base.stl", "yoke.stl", "head.usdz"):
                asset = source / "assets" / name
                if asset.is_file():
                    (target / "assets").mkdir(exist_ok=True)
                    shutil.copy2(asset, target / "assets" / name)
