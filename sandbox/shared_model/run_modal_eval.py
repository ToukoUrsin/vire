"""Run conditions (b), (c), (d) for one person in a network-blocked Modal Sandbox.

    python run_modal_eval.py <shared.json> <labelled.json> <baseline.json> <out.json>

shared.json: weights from modal_pretrain.py fetch. labelled.json: {"minutes": [...]} with `_labels` (prepare_labels.ts).
baseline.json: run_baseline.py's output, whose held-out windows every condition is scored on.
The sandbox has no public-data volume and no network; the minutes go in over stdin, one JSON result comes back.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    shared, labelled, baseline, out = map(Path, sys.argv[1:])
    here = Path(__file__).resolve().parent
    import modal  # type: ignore

    image = (modal.Image.debian_slim(python_version="3.12").pip_install("numpy")
             .pip_install("torch", index_url="https://download.pytorch.org/whl/cpu")
             .add_local_file(str(here / "model.py"), remote_path="/app/model.py")
             .add_local_file(str(here / "sandbox_eval.py"), remote_path="/app/sandbox_eval.py"))
    app = modal.App.lookup("vire-shared-model-eval", create_if_missing=True)
    payload = {"shared": json.loads(shared.read_text()), "minutes": json.loads(labelled.read_text())["minutes"],
               "held": json.loads(baseline.read_text())["held"]}
    t0 = time.time()
    sb = modal.Sandbox.create("bash", "-lc", "cd /app && python3 sandbox_eval.py", image=image, app=app,
                              timeout=900, cpu=4, memory=8192, block_network=True)
    result = None
    try:
        sb.stdin.write(json.dumps(payload).encode()); sb.stdin.write_eof(); sb.stdin.drain()
        pending = ""
        for chunk in sb.stdout:
            pending += chunk.decode("utf-8", "replace") if isinstance(chunk, bytes) else chunk
            *lines, pending = pending.split("\n")
            for line in lines + ([pending] if False else []):
                try:
                    v = json.loads(line)
                except Exception:
                    continue
                if "progress" in v:
                    print("progress", v["progress"], flush=True)
                if "result" in v:
                    result = v["result"]
        if pending.strip():
            try:
                result = json.loads(pending).get("result", result)
            except Exception:
                pass
        sb.wait()
        if result is None:
            raise RuntimeError(f"shared eval failed ({sb.returncode}): {str(sb.stderr.read())[-1500:]}")
    finally:
        try:
            sb.terminate()
        except Exception:
            pass
    result["sandbox_wall_s"] = round(time.time() - t0, 1)
    out.write_text(json.dumps(result))
    print(json.dumps(result)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
