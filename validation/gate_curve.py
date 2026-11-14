#!/usr/bin/env python3
"""Accuracy against coverage as the quality threshold moves: which bpm values should the app withhold?

    python3 -I validation/gate_curve.py <explore_dir> [<explore_dir> ...]

Reads explore_pulse.ts output (bpm never withheld) and, for each quality threshold, treats samples below it as
withheld. Same windows and reference as score_pulse.py.
"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_pulse as sp  # noqa: E402


def windows(path):
    with open(path) as f:
        d = json.load(f)
    ppg, dev, gt_t = sp.load_gt(d["id"])
    n = len(ppg)
    fps_true = (n - 1) / gt_t[-1]
    face = np.array([[np.nan if v is None else v for v in r] for r in d["face"]], float)
    pulse = np.array([[np.nan if v is None else v for v in r] for r in d["pulse"]], float)
    t = face[:, 0] / 1000
    k = face[:, 1]
    ok = (k >= 0) & (face[:, 2] == 0)
    sl, ic = np.polyfit(t[ok], k[ok], 1)
    bpm = pulse[:, 1] * fps_true / sl
    q = pulse[:, 2]
    tu = np.arange(0, gt_t[-1], 1 / 30)
    ppg_u = np.interp(tu, gt_t, ppg)
    rows = []
    T = t[0] + sp.WARM_S
    while T <= t[-1] - 0.5:
        sel = (t >= T - 0.5) & (t <= T + 0.5)
        k1 = sl * (T - sp.POS_DELAY_S) + ic
        k0 = k1 - sp.WIN_S * sl
        if sel.sum() >= 3 and k0 >= 0 and k1 <= n - 1:
            a0, a1 = np.interp([k0, k1], np.arange(n), gt_t)
            ref = sp.spectral_bpm(ppg_u[(tu >= a0) & (tu <= a1)], 30)
            rows.append((d["id"], bpm[sel], q[sel], ref))
        T += sp.STEP_S
    after = t >= t[0] + 8
    return rows, q[after], d.get("resets", 0)


for raw in sys.argv[1:]:
    rows = []
    qs = []
    resets = 0
    for p in sorted(glob.glob(f"{raw}/subject*.json")):
        r, qa, rs = windows(p)
        rows += r
        qs.append(qa)
        resets += rs
    qall = np.concatenate(qs)
    print(f"\n{raw}  windows {len(rows)}  resets {resets}")
    print(f"{'thr':>5} {'cov%':>6} {'winRep%':>8} {'MAE':>6} {'RMSE':>6} {'w5%':>6} {'worst':>6} {'subj>5':>6}")
    table = []
    for thr in (0.0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5):
        errs = []
        bad = set()
        for sub, b, q, ref in rows:
            have = np.isfinite(b) & (q >= thr)
            if have.mean() >= 0.5:
                e = float(np.median(b[have])) - ref
                errs.append(e)
                if abs(e) > 5:
                    bad.add(sub)
        e = np.array(errs)
        cov = float((np.nan_to_num(qall, nan=0) >= thr).mean() * 100) if thr > 0 else float(np.isfinite(qall).mean() * 100)
        print(f"{thr:5.2f} {cov:6.1f} {100 * len(e) / len(rows):8.1f} {np.abs(e).mean():6.2f} {np.sqrt((e**2).mean()):6.2f} {(np.abs(e) <= 5).mean() * 100:6.1f} {np.abs(e).max():6.1f} {len(bad):6d}")
        table.append({"threshold": thr, "coveragePct": round(cov, 1), "windows": len(rows), "windowsReported": len(e), "maeBpm": round(float(np.abs(e).mean()), 2), "rmseBpm": round(float(np.sqrt((e**2).mean())), 2), "within5Pct": round(float((np.abs(e) <= 5).mean() * 100), 1), "worstErrBpm": round(float(np.abs(e).max()), 1)})
    with open(raw.rstrip("/") + ".gate.json", "w") as f:
        json.dump({"dir": raw, "resets": resets, "rows": table}, f, indent=1)
