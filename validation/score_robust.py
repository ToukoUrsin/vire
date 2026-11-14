#!/usr/bin/env python3
"""Score the degraded-condition runs (make_conditions.py) and write one line per video.

    python3 -I validation/score_robust.py <pulse_raw_dir> <smile_raw_dir> <out.jsonl>

(The noise dose-response run has pulse files only: give it an empty directory for the smile side.)

Pulse files are scored like score_pulse.py (same windows, same reference), smile files like score_smile.py
(same hand labels, same 0.15 threshold). Every condition is cut from the same seconds of the same videos, so
"original" in this table is the like-for-like baseline (it is a subset: do not compare it with the full-set numbers).
"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_pulse  # noqa: E402
import score_smile  # noqa: E402

ORDER = ["original", "light50", "light25", "light12", "backlight", "noise", "fps15", "halfres", "dim50", "noiseLow", "noiseMid"]
PULSE_SECONDS = 35


def pct(a, b):
    return None if not b else round(100 * a / b, 1)


def main():
    pulse_dir, smile_dir, outp = sys.argv[1:4]
    rows = []
    for p in sorted(glob.glob(f"{pulse_dir}/*__*.json")):
        sub, cond = os.path.basename(p)[:-5].split("__")
        try:
            r = score_pulse.score(p, sub=sub, stride=2 if cond == "fps15" else 1, max_s=PULSE_SECONDS)
        except Exception as e:  # noqa: BLE001
            print("skip", p, type(e).__name__, e, file=sys.stderr)
            continue
        rep = [w for w in r["windowRows"] if w["ours"] is not None]
        rows.append({
            "kind": "pulse", "video": f"UBFC-rPPG {sub}, first {PULSE_SECONDS} s", "source": sub, "condition": cond,
            "faceFoundPct": r["faceFoundPct"], "faceWidthPx": r["faceWidthPx"], "skinLuma": r["skinLuma"],
            "pulseCoveragePct": r["coveragePct"], "windows": r["windows"], "windowsReported": r["windowsReported"],
            "maeBpm": r["maeBpm"], "within5Pct": r["within5Pct"], "worstErrBpm": round(max(abs(w["ours"] - w["ref"]) for w in rep), 1) if rep else None,
            "errs": [round(w["ours"] - w["ref"], 2) for w in rep], "medianQuality": r["medianQuality"], "pipelineFps": r["pipelineFpsMean"],
        })
    labels = score_smile.load_labels()
    for p in sorted(glob.glob(f"{smile_dir}/*__*.json")):
        vid, cond = os.path.basename(p)[:-5].split("__")
        lab = dict(labels[vid])
        if cond == "fps15":
            lab["frames"] = [k // 2 for k in lab["frames"]]
        r = score_smile.score_clip(p, lab)
        rows.append({
            "kind": "smile", "video": r["source"], "source": vid, "condition": cond, "person": r["person"], "labels": r["labels"],
            "faceFoundPct": r["faceFoundPct"], "faceWidthPx": r["faceWidthPx"], "skinLuma": r["skinLuma"],
            "sFrames": r["sFrames"], "sDetected": r["sDetected"], "nFrames": r["nFrames"], "nDetected": r["nDetected"],
            "smileAtFrames": r["smileAtFrames"], "smileMedianOnS": r["smileMedianOnS"], "smileMaxOnN": r["smileMaxOnN"],
        })
    with open(outp, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    summary = []
    print(f"{'condition':10} | pulse: {'n':>2} {'face%':>6} {'cov%':>6} {'rep/win':>8} {'MAE':>5} {'w5%':>5} {'worst':>5} {'luma':>5} {'faceW':>5} | smile: {'n':>2} {'face%':>6} {'sens%':>6} {'S':>3} {'fp%':>5} {'N':>3} {'smileS':>6} {'luma':>5} {'faceW':>5}")
    for c in ORDER:
        pu = [r for r in rows if r["kind"] == "pulse" and r["condition"] == c]
        sm = [r for r in rows if r["kind"] == "smile" and r["condition"] == c]
        if not pu and not sm:
            continue
        errs = np.array([e for r in pu for e in r["errs"]])
        s = {"condition": c, "pulseVideos": len(pu), "smileVideos": len(sm)}
        if pu:
            s.update({
                "pulseFaceFoundPct": round(float(np.mean([r["faceFoundPct"] for r in pu])), 1),
                "pulseCoveragePct": round(float(np.mean([r["pulseCoveragePct"] or 0 for r in pu])), 1),
                "pulseWindows": sum(r["windows"] for r in pu), "pulseWindowsReported": sum(r["windowsReported"] for r in pu),
                "pulseMaeBpm": round(float(np.abs(errs).mean()), 2) if len(errs) else None,
                "pulseWithin5Pct": round(float((np.abs(errs) <= 5).mean() * 100), 1) if len(errs) else None,
                "pulseWorstErrBpm": round(float(np.abs(errs).max()), 1) if len(errs) else None,
                "pulseSkinLuma": round(float(np.median([r["skinLuma"] for r in pu if r["skinLuma"] is not None]))) if any(r["skinLuma"] is not None for r in pu) else None,
                "pulseFaceWidthPx": round(float(np.median([r["faceWidthPx"] for r in pu if r["faceWidthPx"] is not None]))) if any(r["faceWidthPx"] is not None for r in pu) else None,
            })
        if sm:
            sS, sD = sum(r["sFrames"] for r in sm), sum(r["sDetected"] for r in sm)
            nN, nD = sum(r["nFrames"] for r in sm), sum(r["nDetected"] for r in sm)
            ms = [r["smileMedianOnS"] for r in sm if r["smileMedianOnS"] is not None and r["sFrames"] >= 2]
            s.update({
                "smileFaceFoundPct": round(float(np.mean([r["faceFoundPct"] or 0 for r in sm])), 1),
                "smileSensitivityPct": pct(sD, sS), "smileSFrames": sS,
                "smileFalsePositivePct": pct(nD, nN), "smileNFrames": nN,
                "smileScoreOnClearSmiles": round(float(np.median(ms)), 3) if ms else None,
                "smileSkinLuma": round(float(np.median([r["skinLuma"] for r in sm if r["skinLuma"] is not None]))) if any(r["skinLuma"] is not None for r in sm) else None,
                "smileFaceWidthPx": round(float(np.median([r["faceWidthPx"] for r in sm if r["faceWidthPx"] is not None]))) if any(r["faceWidthPx"] is not None for r in sm) else None,
            })
        summary.append(s)
        g = lambda k, n=1: "-" if s.get(k) is None else (f"{s[k]:.{n}f}" if isinstance(s[k], float) else str(s[k]))  # noqa: E731
        print(f"{c:10} | pulse: {len(pu):2d} {g('pulseFaceFoundPct'):>6} {g('pulseCoveragePct'):>6} {g('pulseWindowsReported') + '/' + g('pulseWindows'):>8} {g('pulseMaeBpm', 2):>5} {g('pulseWithin5Pct'):>5} {g('pulseWorstErrBpm'):>5} {g('pulseSkinLuma'):>5} {g('pulseFaceWidthPx'):>5} | smile: {len(sm):2d} {g('smileFaceFoundPct'):>6} {g('smileSensitivityPct'):>6} {g('smileSFrames'):>3} {g('smileFalsePositivePct'):>5} {g('smileNFrames'):>3} {g('smileScoreOnClearSmiles', 2):>6} {g('smileSkinLuma'):>5} {g('smileFaceWidthPx'):>5}")
    with open(outp.replace(".jsonl", "") + ".summary.json", "w") as f:
        json.dump(summary, f, indent=1)


if __name__ == "__main__":
    main()
