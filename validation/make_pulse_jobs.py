#!/usr/bin/env python3
"""Write the run_lab.mjs job list for every UBFC-rPPG subject that has been fetched.

    python3 -I validation/make_pulse_jobs.py > /bulk2/runs/depression/validation/tmp/pulse_jobs.jsonl
"""
import glob
import json
import os

ROOT = "/bulk2/runs/depression/validation/pulse/ubfc/DATASET_2"
subs = sorted((os.path.basename(os.path.dirname(p)) for p in glob.glob(f"{ROOT}/*/meta.json")), key=lambda s: int(s.replace("subject", "")))
for s in subs:
    with open(f"{ROOT}/{s}/meta.json") as f:
        m = json.load(f)
    if not os.path.exists(f"{ROOT}/{s}/cam.y4m"):
        continue
    # the file plays at 5 fps; the page clock is slowed by playFps / 5 so the pipeline sees the camera's own rate.
    # delegate=cpu: headless Chrome has no GPU, and the app's own speed test (which picks the CPU there) cannot
    # work under a slowed clock, so the choice it would make is pinned.
    print(json.dumps({"id": s, "video": f"{ROOT}/{s}/cam.y4m", "frames": m["frames"], "fps": 5, "warp": m["playFps"] / 5, "query": "&delegate=cpu"}))
