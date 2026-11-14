#!/usr/bin/env python3
"""Assemble the deliverables from the score files under /bulk2/runs/depression/validation/scores:

    validation/results-pulse.jsonl       one line per UBFC-rPPG video
    validation/results-smile.jsonl       one line per face clip
    validation/results-robustness.jsonl  one line per degraded video
    validation/summary.json              the numbers the app shows (schema: CONTRACT.md, Round 2)
    web/public/validation.json           identical copy

    python3 -I validation/build_summary.py

Only aggregate numbers and per-video scores leave /bulk2: no frames, no faces.
"""
import datetime
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BASE = "/bulk2/runs/depression/validation"
S = f"{BASE}/scores"

CONDITION_NAMES = {
    "original": "Unchanged video",
    "light50": "Half the light, some camera noise",
    "light25": "Quarter of the light, more noise",
    "light12": "One eighth of the light (dark corner)",
    "backlight": "Backlit: dark face, washed-out contrast",
    "noise": "Normal light, heavy camera noise",
    "fps15": "15 frames per second",
    "halfres": "Half resolution (face about 65 px wide)",
}


def jl(path):
    with open(path) as f:
        return [json.loads(ln) for ln in f if ln.strip()]


def js(path):
    with open(path) as f:
        return json.load(f)


def main():
    # ---- pulse
    pulse = jl(f"{S}/pulse_v1_warp.jsonl")
    ps = js(f"{S}/pulse_v1_warp.summary.json")
    steady = js(f"{S}/pulse_v0_warp.summary.json")  # same code path on steadier frames (see README "What we changed")
    swing = js(f"{BASE}/swing/swing-summary.json")
    gate = {r["threshold"]: r for r in js(f"{BASE}/raw/explore_v1warp_gap1000.gate.json")["rows"]}
    with open(f"{HERE}/results-pulse.jsonl", "w") as f:
        for r in pulse:
            f.write(json.dumps(r) + "\n")

    # ---- smile
    smile = jl(f"{S}/smile_v1.jsonl")
    ss = js(f"{S}/smile_v1.summary.json")
    with open(f"{HERE}/results-smile.jsonl", "w") as f:
        for r in smile:
            f.write(json.dumps(r) + "\n")

    # ---- robustness
    rob = jl(f"{S}/robust_v1.jsonl")
    extra = jl(f"{S}/robust_v1b.jsonl") if os.path.exists(f"{S}/robust_v1b.jsonl") else []
    for r in extra:
        r["run"] = "noise dose-response"
    with open(f"{HERE}/results-robustness.jsonl", "w") as f:
        for r in rob + extra:
            f.write(json.dumps(r) + "\n")
    robustness = []
    for c, name in CONDITION_NAMES.items():
        rows = [r for r in rob if r["condition"] == c]
        pu = [r for r in rows if r["kind"] == "pulse"]
        sm = [r for r in rows if r["kind"] == "smile"]
        s_frames = sum(r["sFrames"] for r in sm)
        robustness.append({
            "condition": name,
            "faceFoundPct": round(sum(r["faceFoundPct"] or 0 for r in rows) / len(rows), 1),
            "pulseCoveragePct": round(sum(r["pulseCoveragePct"] or 0 for r in pu) / len(pu), 1),
            "smileSensitivityPct": round(100 * sum(r["sDetected"] for r in sm) / s_frames, 1),
        })

    a = ss["all"]
    wf = ss["wellFramed"]["inside"]
    out = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pulse": {
            "dataset": "UBFC-rPPG, dataset 2 (Bobbia et al. 2017)",
            "url": "https://sites.google.com/view/ybenezeth/ubfcrppg",
            "subjects": ps["subjects"],
            "minutes": ps["minutes"],
            "maeBpm": ps["maeBpm"],
            "rmseBpm": ps["rmseBpm"],
            "within5Pct": ps["within5Pct"],
            "coveragePct": ps["coveragePct"],
            "reference": "Finger pulse oximeter (CMS50E) recorded with each video: the rate of its pulse wave over the same video frames",
            "note": (
                f"Error is over the {ps['windowsReported']} of {ps['windows']} ten-second windows where the app showed a number; it shows none when the signal is weak. "
                f"With nothing withheld the error is {gate[0.0]['maeBpm']} bpm (RMSE {gate[0.0]['rmseBpm']}). "
                f"Coverage rose to {steady['coveragePct']} % on a run that dropped fewer frames. "
                "16 of the dataset's 42 people: the download quota stopped the rest. Still, well-lit people at a desk."
            ),
        },
        "heartSwing": {
            "dataset": "UBFC-rPPG dataset 2, 20-second windows in 10-second steps",
            "reference": "Finger oximeter over the same seconds, through the same beat picking and the same lock-in",
            "people": swing["people"],
            "windows": swing["windows"],
            "windowsReferenceClean": swing["windowsReferenceClean"],
            "windowsShown": swing["windowsShown"],
            "shownPct": swing["shownPct"],
            "maeBpm": swing["new"]["mae"],
            "medianAbsErrorBpm": swing["new"]["medianAbsError"],
            "biasBpm": swing["new"]["bias"],
            "rmseBpm": swing["new"]["rmse"],
            "correlation": swing["new"]["correlation"],
            "limitsOfAgreementBpm": swing["new"]["loa95"],
            "meanReferenceBpm": swing["new"]["meanReference"],
            "worst": swing["new"]["worst"],
            "byHalf": {h: {k: swing["newByHalf"][h].get(k) for k in ("windows", "mae", "bias", "correlation")} for h in ("A", "B")},
            "seCalibration": swing["seCalibration"],
            "oldMaeBpm": swing["old"]["mae"],
            "oldBiasBpm": swing["old"]["bias"],
            "oldRmseBpm": swing["old"]["rmse"],
            "oldCorrelation": swing["old"]["correlation"],
            "oldLimitsOfAgreementBpm": swing["old"]["loa95"],
            "errorByReferenceSwing": {"new": swing["new"]["byReferenceSwing"], "old": swing["old"]["byReferenceSwing"]},
            "still": swing["still"],
            "dropouts": swing["dropouts"],
            "ownPeriod": {k: swing["ownPeriod"].get(k) for k in ("windows", "people", "mae", "bias", "correlation", "meanReference")},
            "oneBreath": {k: swing["oneBreath"].get(k) for k in ("windowsReferenceClean", "windows", "people", "mae", "bias", "correlation", "meanReference")},
            "lateStamps": {k: swing["lateStamps"].get(k) for k in ("windows", "people", "mae", "bias", "correlation")},
            "knownSwing": swing["knownSwing"],
            "browser": swing["browser"],
            "gate": swing["gate"],
            "note": swing["limits"],
        },
        "smile": {
            "clips": a["clips"],
            "people": a["people"],
            "sensitivityPct": a["sensitivityPct"],
            "falsePositivePct": a["falsePositivePct"],
            "faceFoundPct": a["faceFoundPct"],
            "source": "Mixkit free stock video (mixkit.co), frames labelled by eye before any score was seen",
            "note": (
                f"{a['sFrames']} clear-smile frames and {a['nFrames']} no-smile frames; a smile counts as found at a raw score of 0.15 or more (AUC {a['aucSvsN']}). "
                f"Facing the camera with the face at least 100 px wide: {wf['sensitivityPct']} % found, {wf['falsePositivePct']} % false positives. "
                f"Subtle smiles ({a['subtleFrames']} frames, scored apart): {a['subtleDetectedPct']} % found."
            ),
        },
        "robustness": robustness,
        "limits": [
            "This validates that the sensors read the body. It does not test any link between these readings and depression.",
            "Pulse: one webcam dataset of still, well-lit people (16 of 42), uncompressed video. No phone camera, no moving or talking people.",
            "Heart swing: the same 16 people, who breathed as they liked. A known paced swing is simulated or synthetic so far, never a person.",
            "Pulse in dim or noisy light: the app showed no number rather than a wrong one. Expect that in a dark hall.",
            "Smile: one rater, six frames per clip, stock footage. Few people with medium (5) or dark (8) skin, 4 children, 12 older adults.",
            "Smile false positives come mostly from turned heads and small faces: 26 % outside the framing limits, 3 % inside.",
            "Bad conditions are simulated with filters on the same videos, not filmed in a dark room.",
            "Frame rate on a phone was not measured: runs were in headless desktop Chrome on a server.",
            "Voice and head-movement sensors are not part of this validation.",
        ],
    }
    with open(f"{HERE}/summary.json", "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    shutil.copyfile(f"{HERE}/summary.json", f"{REPO}/web/public/validation.json")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
