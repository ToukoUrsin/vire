"""Run one person's ear search in a Modal Sandbox of its own, with the network blocked.

stdin is one JSON envelope: {"minutes": [...]} (every teaching minute of the person, oldest first).
stdout is newline JSON: {"sandbox": id}, then {"tried": {name, auc, ms}} as candidates finish, then
{"result": {model, board, ...}} or {"error": "..."}.

The sandbox gets the phone's own ear code (web/src/tune/ear, run with bun) and sandbox/search.py, nothing else of
the app, and no way out: the minutes go in over stdin and the model comes back over stdout.

VIRE_MODAL_LOCAL=1 runs the same search on this machine instead (for tests without Modal).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

APP = "vire-ear-sandbox"
CPU = float(os.environ.get("VIRE_SANDBOX_CPU", "32"))
BUDGET = os.environ.get("VIRE_SEARCH_BUDGET", "40")


def emit(value: object) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def relay(line: str) -> bool:
    """Pass on what the search says. True when that ended it: the result, or the search's own reason for none."""
    try:
        value = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return False
    if isinstance(value, dict) and any(k in value for k in ("tried", "result", "error", "note")):
        emit(value)
        return "result" in value or "error" in value
    return False


def run_local(envelope: dict, repo: Path) -> int:
    with tempfile.TemporaryDirectory(prefix="vire-ear-") as td:
        minutes = Path(td) / "minutes.json"
        minutes.write_text(json.dumps({"minutes": envelope["minutes"]}), encoding="utf-8")
        cmd = [sys.executable, str(repo / "sandbox/search.py"), str(minutes), str(Path(td) / "out.json"), "--budget", BUDGET, "--jobs", os.environ.get("VIRE_SEARCH_JOBS", "6"), "--repo", str(repo)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert proc.stdout is not None
        ok = False
        for line in proc.stdout:
            ok = relay(line) or ok
        code = proc.wait()
        if not ok:
            emit({"error": f"the search ended without a model (exit {code})"})
        return 0 if ok else 1


def run_modal(envelope: dict, repo: Path) -> int:
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
    )
    app = modal.App.lookup(APP, create_if_missing=True)
    command = (
        "export PATH=/root/.bun/bin:$PATH; cat > /tmp/minutes.json; "
        f"python3 /app/sandbox/search.py /tmp/minutes.json /tmp/out.json --budget {BUDGET} --jobs {int(CPU)} --repo /app"
    )
    sandbox = modal.Sandbox.create("bash", "-lc", command, image=image, app=app, timeout=240, cpu=CPU, memory=16384, block_network=True)
    emit({"sandbox": sandbox.object_id})
    ok = False
    try:
        sandbox.stdin.write(json.dumps({"minutes": envelope["minutes"]}).encode("utf-8"))
        sandbox.stdin.write_eof()
        sandbox.stdin.drain()
        pending = ""
        for chunk in sandbox.stdout:
            if isinstance(chunk, bytes):
                chunk = chunk.decode("utf-8", "replace")
            pending += chunk
            *lines, pending = pending.split("\n")
            for line in lines:
                ok = relay(line) or ok
        if pending.strip():
            ok = relay(pending) or ok
        sandbox.wait()
        if not ok:
            err = sandbox.stderr.read()
            emit({"error": f"sandbox ended without a model (exit {sandbox.returncode}): {str(err)[-300:]}"})
    finally:
        try:
            sandbox.terminate()
        except Exception:
            pass
    return 0 if ok else 1


def main() -> int:
    envelope = json.load(sys.stdin)
    if not envelope.get("minutes"):
        envelope["minutes"] = [envelope["recording"]] if envelope.get("recording") else []
    if not envelope["minutes"]:
        emit({"error": "no minutes to learn from"})
        return 1
    repo = Path(os.environ.get("VIRE_REPO", Path(__file__).resolve().parent.parent))
    if os.environ.get("VIRE_MODAL_LOCAL") == "1":
        return run_local(envelope, repo)
    try:
        return run_modal(envelope, repo)
    except Exception as exc:
        # the worker's line protocol stays intact, and nothing from the SDK's own errors beyond the first words
        emit({"error": f"Modal run failed: {type(exc).__name__}: {str(exc)[:300]}"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
