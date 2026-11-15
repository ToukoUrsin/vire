"""Re-train every patient of the clinic at once: one Modal Sandbox per patient, all started together, network blocked.

stdin is one JSON envelope: {"dir": "/tmp/...", "patients": N}. The folder holds p1.json ... pN.json, each
{"minutes": [...], "practices": [...]}: one patient's teaching minutes and practice history (simulated: the worker makes
them with sandbox/cohort_minutes.ts). Each patient's sandbox gets that patient's file only, runs sandbox/search.py on the
minutes, then sandbox/works.py on the practices (what helps this patient most, the app's own learner), and is gone after.

stdout is newline JSON, about once a second:
    {"cohort": {"patients": [{n, state, tried, seconds, auc, works?}], "seconds", "sandboxes", "peak", "where", "refused"}}
and at the end {"done": {...the same...}} or {"error": "...", "cohort": {...}}. A {"note": ...} line says what Modal
refused, if anything. "sandboxes" counts sandboxes that have started running (their first line came back) and not yet
ended; "peak" is the most of those at one moment. A sandbox Modal has accepted but not yet started is not counted.

VIRE_MODAL_LOCAL=1 runs the same searches on this machine instead, at most three at a time.
Each patient has VIRE_COHORT_DEADLINE seconds (default 60) from the sandbox request; a timeout is a failed patient.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

APP = "vire-ear-sandbox"
CPU = float(os.environ.get("VIRE_COHORT_CPU", "8"))
MEMORY = int(os.environ.get("VIRE_COHORT_MEMORY", "6144"))
BUDGET = os.environ.get("VIRE_COHORT_BUDGET", "12")
LOCAL_AT_ONCE = 3
LOCAL_JOBS = os.environ.get("VIRE_COHORT_LOCAL_JOBS", "4")
try:
    DEADLINE = max(1.0, float(os.environ.get("VIRE_COHORT_DEADLINE", "60")))
except ValueError:
    DEADLINE = 60.0
# A sandbox that has not tried one model this long after it was asked for landed on a slow machine (most patients are
# finished by then): it is dropped and the patient gets one fresh sandbox. So does a patient whose first sandbox ended
# without a model. One second try only; the worker logs it.
try:
    SLOW = max(1.0, float(os.environ.get("VIRE_COHORT_SLOW", "24")))
except ValueError:
    SLOW = 24.0
TAUGHT = ("smile", "nod", "shake")
OUT = threading.Lock()


def emit(value: object) -> None:
    with OUT:
        print(json.dumps(value, separators=(",", ":")), flush=True)


def deadline_error() -> str:
    shown = int(DEADLINE) if DEADLINE.is_integer() else DEADLINE
    return f"took longer than {shown} seconds"


class Board:
    """What every patient's sandbox has said so far. One lock; the ticker reads it once a second."""

    def __init__(self, n: int, where: str):
        self.lock = threading.Lock()
        self.where = where
        self.started = time.time()
        self.p = [{"n": i + 1, "state": "waiting", "tried": 0, "seconds": 0.0, "auc": None, "error": None, "works": None, "t0": None, "t1": None} for i in range(n)]
        self.peak = 0
        self.refused = 0
        self.again = 0
        self.errors: list[str] = []

    def running(self) -> int:
        return sum(1 for p in self.p if p["state"] == "running")

    def begin(self, i: int) -> None:
        with self.lock:
            if self.p[i]["state"] == "waiting":
                self.p[i]["state"] = "running"
                self.p[i]["t0"] = time.time()
                self.peak = max(self.peak, self.running())

    def tried(self, i: int) -> None:
        with self.lock:
            self.p[i]["tried"] += 1

    def works(self, i: int, works: dict) -> None:
        with self.lock:
            self.p[i]["works"] = works

    def end(self, i: int, auc: float | None, tried: int | None, error: str | None = None) -> None:
        with self.lock:
            p = self.p[i]
            p["t0"] = p["t0"] or time.time()
            p["t1"] = time.time()
            p["state"] = "done" if auc is not None and not error else "failed"
            p["auc"] = round(auc, 4) if auc is not None and not error else None
            p["error"] = error
            if tried is not None:
                p["tried"] = max(p["tried"], tried)
            if error:
                self.errors.append(f"patient {i + 1}: {error}"[:300])

    def retry(self, i: int, why: str) -> None:
        """The patient's first sandbox is dropped: what it counted is forgotten, the clock keeps running."""
        with self.lock:
            self.again += 1
            self.p[i]["tried"] = 0
            self.p[i]["works"] = None
        emit({"note": {"again": f"patient {i + 1}: {why}"[:300]}})

    def refuse(self, why: str) -> None:
        with self.lock:
            self.refused += 1
            first = self.refused == 1
        if first:
            emit({"note": {"refused": why[:300]}})

    def snapshot(self) -> dict:
        with self.lock:
            now = time.time()
            out = []
            for p in self.p:
                secs = 0.0 if p["t0"] is None else (p["t1"] or now) - p["t0"]
                one = {"n": p["n"], "state": p["state"], "tried": p["tried"], "seconds": round(secs, 1), "auc": p["auc"]}
                if p["works"] is not None:
                    one["works"] = p["works"]
                if p["error"]:
                    one["error"] = p["error"]
                out.append(one)
            return {"patients": out, "seconds": round(now - self.started, 1), "sandboxes": self.running(), "peak": self.peak, "where": self.where, "refused": self.refused}

    def over(self) -> bool:
        with self.lock:
            return all(p["state"] in ("done", "failed") for p in self.p)


def held_out(model: dict) -> float | None:
    """The mean held-out score over smile, nod and head shake: the same number the phone and the big screen show."""
    got = [v["score"]["auc"] for e, v in (model.get("events") or {}).items() if e in TAUGHT and v.get("score", {}).get("windows", 0) > 0]
    return sum(got) / len(got) if got else None


def take(board: Board, i: int, line: str) -> dict | None:
    """One line from a patient's search. Returns the end of it (result or error) when this line was that."""
    try:
        value = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    if "up" in value or "note" in value:
        board.begin(i)
    if "tried" in value:
        board.begin(i)
        board.tried(i)
    if isinstance(value.get("works"), dict):
        board.works(i, value["works"])
    if "result" in value or "error" in value:
        return value
    return None


def finish(board: Board, i: int, end: dict | None, fallback: str) -> None:
    if end and "result" in end:
        model = end["result"].get("model") or {}
        auc = held_out(model)
        board.end(i, auc, model.get("tried"), None if auc is not None else "no score came back")
    else:
        board.end(i, None, None, (end or {}).get("error") or fallback)


def run_local(board: Board, folder: Path, repo: Path) -> None:
    gate = threading.Semaphore(LOCAL_AT_ONCE)

    def one(i: int) -> None:
        with gate:
            with tempfile.TemporaryDirectory(prefix="vire-cohort-") as td:
                cmd = [sys.executable, str(repo / "sandbox/search.py"), str(folder / f"p{i + 1}.json"), str(Path(td) / "out.json"), "--budget", BUDGET, "--jobs", LOCAL_JOBS, "--repo", str(repo)]
                started = time.monotonic()
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                board.begin(i)
                try:
                    stdout, _ = proc.communicate(timeout=max(0.01, DEADLINE - (time.monotonic() - started)))
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.communicate()
                    board.end(i, None, None, deadline_error())
                    return
                end = None
                for line in stdout.splitlines():
                    end = take(board, i, line) or end
                code = proc.returncode
                remaining = DEADLINE - (time.monotonic() - started)
                if remaining <= 0:
                    board.end(i, None, None, deadline_error())
                    return
                try:
                    learned = subprocess.run([sys.executable, str(repo / "sandbox/works.py"), str(folder / f"p{i + 1}.json")], capture_output=True, text=True, timeout=remaining)
                except subprocess.TimeoutExpired:
                    board.end(i, None, None, deadline_error())
                    return
                for line in learned.stdout.splitlines():
                    take(board, i, line)
                finish(board, i, end, f"the search ended without a model (exit {code})")

    with ThreadPoolExecutor(max_workers=LOCAL_AT_ONCE) as pool:
        list(pool.map(one, range(len(board.p))))


def run_modal(board: Board, folder: Path, repo: Path) -> None:
    import modal  # type: ignore

    # the same image as modal_runner.py (same layers, so Modal has it built already)
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
        .add_local_file(str(repo / "sandbox/works.py"), remote_path="/app/sandbox/works.py")
    )
    app = modal.App.lookup(APP, create_if_missing=True)
    # The sandbox says it is up first thing: from then on it counts as running. A fresh sandbox reads its image's files
    # lazily, and the first import of torch and scikit-learn in eight workers at once was seen to eat a whole search
    # budget (6 models tried instead of ~230): they are read once while the minutes come in, before the search starts.
    # After the search, the same sandbox learns what helps this patient most from their practices (well under a second).
    command = (
        "echo '{\"up\":1}'; export PATH=/root/.bun/bin:$PATH; "
        "(python3 -c 'import numpy, scipy.stats, sklearn.linear_model, sklearn.ensemble, sklearn.discriminant_analysis, torch' >/dev/null 2>&1; bun --version >/dev/null 2>&1) & "
        "cat > /tmp/minutes.json; wait; "
        f"python3 /app/sandbox/search.py /tmp/minutes.json /tmp/out.json --budget {BUDGET} --jobs {int(CPU)} --repo /app; "
        "python3 /app/sandbox/works.py /tmp/minutes.json"
    )
    # build the image once, before the patients race for it
    image.build(app)

    def attempt(i: int, last: bool) -> str | None:
        """One sandbox for one patient. None when the patient is settled (done, or failed for good); else why to try once more."""
        sandbox = None
        tries = 0
        while sandbox is None:
            asked = time.monotonic()
            try:
                sandbox = modal.Sandbox.create("bash", "-lc", command, image=image, app=app, timeout=max(1, int(DEADLINE)), cpu=CPU, memory=MEMORY, block_network=True)
            except Exception as exc:  # Modal said no (a limit, a rate): try again a little later
                tries += 1
                board.refuse(f"{type(exc).__name__}: {str(exc)[:240]}")
                if tries >= 8:
                    board.end(i, None, None, f"Modal refused the sandbox {tries} times")
                    return None
                time.sleep(min(8.0, 0.5 * 2 ** tries))
        try:
            sandbox.stdin.write((folder / f"p{i + 1}.json").read_bytes())
            sandbox.stdin.write_eof()
            sandbox.stdin.drain()
            end = None
            pending = ""
            chunks: queue.Queue[object] = queue.Queue()
            def read_stdout() -> None:
                try:
                    for chunk in sandbox.stdout:
                        chunks.put(chunk)
                except Exception as exc:
                    chunks.put(exc)
                finally:
                    chunks.put(None)
            threading.Thread(target=read_stdout, daemon=True).start()
            board.begin(i)
            finished = False
            slow = False
            one_tried = False
            while time.monotonic() - asked < DEADLINE:
                waited = time.monotonic() - asked
                left = DEADLINE - waited
                if not last and not one_tried:
                    if waited >= SLOW:
                        slow = True
                        break
                    left = min(left, SLOW - waited)
                try:
                    chunk = chunks.get(timeout=max(0.01, left))
                except queue.Empty:
                    continue
                if chunk is None:
                    finished = True
                    break
                if isinstance(chunk, Exception):
                    raise chunk
                if isinstance(chunk, bytes):
                    chunk = chunk.decode("utf-8", "replace")
                pending += str(chunk)
                *lines, pending = pending.split("\n")
                for line in lines:
                    one_tried = one_tried or '"tried"' in line
                    end = take(board, i, line) or end
            if slow:
                return f"no model tried {int(SLOW)} seconds after the sandbox was asked for"
            if pending.strip():
                end = take(board, i, pending) or end
            if not finished or time.monotonic() - asked >= DEADLINE:
                board.end(i, None, None, deadline_error())
                return None
            sandbox.wait()
            if (end and "result" in end) or last:
                finish(board, i, end, f"the sandbox ended without a model (exit {sandbox.returncode})")
                return None
            return (end or {}).get("error") or f"the sandbox ended without a model (exit {sandbox.returncode})"
        except Exception as exc:
            why = f"{type(exc).__name__}: {str(exc)[:200]}"
            if last:
                board.end(i, None, None, why)
                return None
            return why
        finally:
            try:
                sandbox.terminate()
            except Exception:
                pass

    def one(i: int) -> None:
        why = attempt(i, False)
        if why is not None:
            board.retry(i, why)
            attempt(i, True)

    # every patient's sandbox is asked for at the same moment
    with ThreadPoolExecutor(max_workers=len(board.p)) as pool:
        list(pool.map(one, range(len(board.p))))


def main() -> int:
    envelope = json.load(sys.stdin)
    folder = Path(envelope["dir"])
    n = int(envelope["patients"])
    if n < 1 or not all((folder / f"p{i + 1}.json").exists() for i in range(n)):
        emit({"error": "the patients' minutes are missing"})
        return 1
    repo = Path(os.environ.get("VIRE_REPO", Path(__file__).resolve().parent.parent))
    local = os.environ.get("VIRE_MODAL_LOCAL") == "1"
    board = Board(n, "local" if local else "modal")
    stop = threading.Event()

    def tick() -> None:
        while not stop.wait(1.0):
            emit({"cohort": board.snapshot()})

    ticker = threading.Thread(target=tick, daemon=True)
    ticker.start()
    try:
        (run_local if local else run_modal)(board, folder, repo)
    except Exception as exc:
        stop.set()
        emit({"error": f"the run failed: {type(exc).__name__}: {str(exc)[:300]}", "cohort": board.snapshot()})
        return 1
    stop.set()
    ticker.join(timeout=2)
    snap = board.snapshot()
    if board.errors:
        emit({"note": {"failed": board.errors[:5]}})
    if not any(p["state"] == "done" for p in snap["patients"]):
        emit({"error": board.errors[0] if board.errors else "no patient got a model", "cohort": snap})
        return 1
    emit({"done": snap})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
