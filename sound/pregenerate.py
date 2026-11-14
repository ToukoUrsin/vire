#!/usr/bin/env python3
"""Fill a Vire server's cache through its public sound API."""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("VIRE_SERVER", "http://127.0.0.1:8883")).rstrip("/")
PACE = {"settle": 10.0, "deep": 6.0, "rest": 5.0}
CALM = {"settle": 0.55, "deep": 0.85, "rest": 0.95}
KINDS = ("breathe", "scan", "walk")
# Two pacing stages x three kinds x four variants = 24 beds.  The API's nearest
# clip selection serves `rest` from the deep bed when a session asks for it.
STAGES = ("settle", "deep")

def post(path: str, value: dict) -> dict:
    request = urllib.request.Request(BASE + path, data=json.dumps(value).encode(), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)

def manifest() -> dict:
    with urllib.request.urlopen(BASE + "/api/sound/manifest", timeout=20) as response:
        return json.load(response)

def main() -> None:
    made = []
    existing = manifest().get("beds", [])
    for kind in KINDS:
        for stage in STAGES:
            for i in range(4):
                input_value = {"kind": kind, "stage": stage, "pace": PACE[stage] + (i - 1.5) * 0.35, "calm": max(0, min(1, CALM[stage] + (i - 1.5) * 0.025)), "seed": 1000 + i, "waitMs": 120000}
                if any(b.get("input", {}).get("kind") == kind and b.get("input", {}).get("stage") == stage and b.get("input", {}).get("seed") == 1000 + i for b in existing):
                    continue
                result = post("/api/sound/segment", input_value)
                made.append(result)
                print(json.dumps({"kind": kind, "stage": stage, "id": result.get("id"), "made": result.get("made"), "model": result.get("model")}))
    for cue in ("settle", "in", "out", "shoulders", "rest", "feet", "hands", "face", "walk", "done"):
        try:
            print(json.dumps(post("/api/sound/cue", {"id": cue})))
        except Exception as exc:
            print(json.dumps({"cue": cue, "error": str(exc)}))
    print(json.dumps({"beds": len(made), "base": BASE}))

if __name__ == "__main__":
    main()
