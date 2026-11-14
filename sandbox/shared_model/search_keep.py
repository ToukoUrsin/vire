"""Condition (a): today's search (sandbox/search.py, unchanged) inside the sandbox, keeping its held-out answers.

search.py works in a temporary folder and returns only scores. To score the shared model on exactly the same
windows, this wrapper keeps that folder and, after the search's own result line, prints one more line:
{"held": {event: {"kind", "chosen", "m", "t", "y", "p"}}}: for every window the search asked about a minute it
never saw (minute index, window end in ms, the camera's label, the chosen model's answer).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, "/app/sandbox")
import search  # noqa: E402

KEEP = "/tmp/keep"


class _Keep:
    def __init__(self, *args, **kwargs):
        os.makedirs(KEEP, exist_ok=True)
        self.name = KEEP

    def __enter__(self):
        return self.name

    def __exit__(self, *exc):
        return False


tempfile.TemporaryDirectory = _Keep  # type: ignore[assignment]

if __name__ == "__main__":
    sys.argv = ["search.py", *sys.argv[1:]]
    code = search.main()
    picked_path = os.path.join(KEEP, "picked.json")
    if os.path.exists(picked_path):
        picked = json.load(open(picked_path))
        held = {e: {"kind": v["kind"], "chosen": v.get("chosen", []), **v["held"]} for e, v in picked["events"].items()}
        print(json.dumps({"held": held}, separators=(",", ":")), flush=True)
    sys.exit(code)
