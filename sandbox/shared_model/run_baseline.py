"""Run condition (a), today's per-person search, on one person's minutes in a network-blocked Modal Sandbox.

    python run_baseline.py <minutes.json> <out.json>

minutes.json is {"minutes": [...]} (full-rate teaching minutes only, oldest first). The sandbox gets the phone's
ear code, sandbox/search.py and search_keep.py, nothing else, and no network. out.json gets the search's result
(as the product's sandbox returns it) plus the held-out answers search_keep.py prints.
The search gets a larger time budget than the product's 40 s, so every candidate finishes: (a) is today's search
at its best, not cut short.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

BUDGET = 240
CPU = 32.0


def main() -> int:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    repo = Path(__file__).resolve().parents[2]
    import modal  # type: ignore

    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("curl", "unzip")
        .run_commands("curl -fsSL https://bun.sh/install | bash")
        .pip_install("numpy", "scipy", "scikit-learn")
        .pip_install("torch", index_url="https://download.pytorch.org/whl/cpu")
        .add_local_dir(str(repo / "web/src/tune/ear"), remote_path="/app/web/src/tune/ear")
        .add_local_dir(str(repo / "web/src/sense"), remote_path="/app/web/src/sense")
        .add_local_dir(str(repo / "web/src/shared"), remote_path="/app/web/src/shared")
        .add_local_dir(str(repo / "shared"), remote_path="/app/shared")
        .add_local_file(str(repo / "sandbox/search.py"), remote_path="/app/sandbox/search.py")
        .add_local_file(str(repo / "sandbox/shared_model/search_keep.py"), remote_path="/app/sandbox/search_keep.py")
    )
    app = modal.App.lookup("vire-shared-model-eval", create_if_missing=True)
    cmd = ("export PATH=/root/.bun/bin:$PATH; cat > /tmp/minutes.json; "
           f"python3 /app/sandbox/search_keep.py /tmp/minutes.json /tmp/out.json --budget {BUDGET} --jobs {int(CPU)} --repo /app")
    t0 = time.time()
    sb = modal.Sandbox.create("bash", "-lc", cmd, image=image, app=app, timeout=BUDGET + 300, cpu=CPU, memory=16384, block_network=True)
    out: dict = {"sandbox": sb.object_id, "budget_s": BUDGET, "cpu": CPU}
    try:
        sb.stdin.write(src.read_bytes()); sb.stdin.write_eof(); sb.stdin.drain()
        pending = ""
        tried = 0
        for chunk in sb.stdout:
            pending += chunk.decode("utf-8", "replace") if isinstance(chunk, bytes) else chunk
            *lines, pending = pending.split("\n")
            for line in lines:
                try:
                    v = json.loads(line)
                except Exception:
                    continue
                if "tried" in v:
                    tried += 1
                    if tried % 50 == 0:
                        print(f"tried {tried}", flush=True)
                for k in ("note", "result", "held", "error"):
                    if k in v:
                        out[k] = v[k]
                        print(k, json.dumps(v[k])[:200] if k != "held" else "(kept)", flush=True)
        sb.wait()
        out["returncode"] = sb.returncode
        if sb.returncode != 0:
            out["stderr"] = str(sb.stderr.read())[-800:]
    finally:
        try:
            sb.terminate()
        except Exception:
            pass
    out["wall_s"] = round(time.time() - t0, 1)
    dst.write_text(json.dumps(out))
    print("wall", out["wall_s"], "rc", out.get("returncode"), flush=True)
    return 0 if "held" in out else 1


if __name__ == "__main__":
    raise SystemExit(main())
