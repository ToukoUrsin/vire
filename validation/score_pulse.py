#!/usr/bin/env python3
"""Score the camera pulse against the UBFC-rPPG finger oximeter.

    python3 -I validation/score_pulse.py <raw_dir> <out.jsonl> [--label v0]

<raw_dir> holds one run_lab.mjs output per subject. For every 5 s step T of the run:
  ours       median of the bpm the pipeline emitted in [T-0.5 s, T+0.5 s]; "reported" when at least half of those
             samples carried a bpm (the pipeline withholds it when quality < 0.3)
  reference  spectral peak (0.66-3 Hz, Hann, zero-padded FFT, parabolic peak) of the contact PPG wave over the same
             video frames the pipeline's estimate covers: the 10 s that end 1.6 s before T (1.6 s is the POS
             overlap-add delay). Frames are matched by the stamp in the corner of each frame, not by clock.
  device     the oximeter's own bpm readout, median over the same frames (secondary reference)
Windows start once the pipeline has had 12 s of video (10 s window + POS delay), so both sides see 10 s.
The video is played at an integer frame rate; every frequency is converted back with the true capture rate
from the ground-truth timestamps.
"""
import glob
import json
import os
import sys

import numpy as np

GT_ROOT = "/bulk2/runs/depression/validation/pulse/ubfc/DATASET_2"
WIN_S = 10.0
POS_DELAY_S = 47 / 30
STEP_S = 5.0
WARM_S = 12.0


def spectral_bpm(x, fs, lo=0.66, hi=3.0):
    x = np.asarray(x, float)
    n = len(x)
    if n < 32:
        return None
    i = np.arange(n)
    x = x - np.polyval(np.polyfit(i, x, 1), i)
    x = x * np.hanning(n)
    nfft = 1 << int(np.ceil(np.log2(n * 8)))
    p = np.abs(np.fft.rfft(x, nfft)) ** 2
    f = np.fft.rfftfreq(nfft, 1 / fs)
    m = np.where((f >= lo) & (f <= hi))[0]
    k = m[np.argmax(p[m])]
    a, b, c = p[k - 1], p[k], p[k + 1]
    d = a - 2 * b + c
    off = 0.5 * (a - c) / d if d != 0 else 0
    return float((k + off) * (fs / nfft) * 60)


def load_gt(sub):
    with open(f"{GT_ROOT}/{sub}/ground_truth.txt") as f:
        rows = [np.array([float(v) for v in ln.split()]) for ln in f.read().strip().split("\n")]
    return rows[0], rows[1], rows[2] - rows[2][0]


def score(path, sub=None, stride=1, max_s=None):
    """sub/stride/max_s are for the robustness runs: the subject the file was cut from, 2 when every second frame
    was dropped (stamped frame k is then ground-truth column 2k), and how many seconds of the run to score."""
    with open(path) as f:
        d = json.load(f)
    sub = sub or d["id"]
    ppg, dev_hr, gt_t = load_gt(sub)
    ppg, dev_hr, gt_t = ppg[::stride], dev_hr[::stride], gt_t[::stride]
    n = len(ppg)
    fps_true = (n - 1) / gt_t[-1]
    face = np.array([[np.nan if v is None else v for v in r] for r in d["face"]], float)
    pulse = np.array([[np.nan if v is None else v for v in r] for r in d["pulse"]], float)
    m = min(len(face), len(pulse))
    if max_s is not None:
        m = min(m, int(np.searchsorted(face[:, 0], face[0, 0] + max_s * 1000, side="right")))
    face, pulse = face[:m], pulse[:m]
    t = face[:, 0] / 1000
    k = face[:, 1]
    ok = (k >= 0) & (face[:, 2] == 0)
    # playback rate as delivered by Chrome (video frames per second of page time)
    sl, ic = np.polyfit(t[ok], k[ok], 1)
    scale = fps_true / sl  # pipeline bpm -> true bpm
    bpm = pulse[:, 1] * scale
    q = pulse[:, 2]
    t0 = t[0]
    dts = np.diff(t)
    # uniform contact PPG in true time
    fs = 30.0
    tu = np.arange(0, gt_t[-1], 1 / fs)
    ppg_u = np.interp(tu, gt_t, ppg)
    rows = []
    T = t0 + WARM_S
    while T <= t[-1] - 0.5:
        sel = (t >= T - 0.5) & (t <= T + 0.5)
        if sel.sum() >= 3:
            b = bpm[sel]
            have = np.isfinite(b)
            reported = have.mean() >= 0.5
            ours = float(np.median(b[have])) if reported else None
            k1 = sl * (T - POS_DELAY_S) + ic
            k0 = k1 - WIN_S * sl
            if k0 >= 0 and k1 <= n - 1:
                a0, a1 = np.interp([k0, k1], np.arange(n), gt_t)
                seg = ppg_u[(tu >= a0) & (tu <= a1)]
                ref = spectral_bpm(seg, fs)
                dsel = dev_hr[int(round(k0)) : int(round(k1)) + 1]
                rows.append({"T": round(T - t0, 2), "ours": None if ours is None else round(ours, 2), "ref": round(ref, 2), "device": round(float(np.median(dsel)), 1), "quality": round(float(np.nanmedian(q[sel])), 3), "gate": round(float(np.nanmedian(face[sel, 11])), 3)})
        T += STEP_S
    rep = [r for r in rows if r["ours"] is not None]
    err = np.array([r["ours"] - r["ref"] for r in rep])
    errd = np.array([r["ours"] - r["device"] for r in rep])
    after = t >= t0 + 8
    present = face[:, 3] == 1
    out = {
        "subject": sub,
        "videoSeconds": round(float(gt_t[-1]), 1),
        "evaluatedSeconds": round(float(t[-1] - t0), 1),
        "captureFps": round(float(fps_true), 3),
        "playedFps": round(float(sl), 3),
        "pipelineFps": round(float(1 / np.median(dts)), 1),
        "pipelineFpsMean": round(float((m - 1) / (t[-1] - t0)), 1),
        "faceFoundPct": round(float(present.mean() * 100), 1),
        "faceWidthPx": round(float(np.nanmedian(face[present, 16])), 0) if present.any() else None,
        "skinLuma": round(float(np.nanmedian(0.299 * face[present, 13] + 0.587 * face[present, 14] + 0.114 * face[present, 15])), 0) if present.any() else None,
        "windows": len(rows),
        "windowsReported": len(rep),
        "coveragePct": round(float(np.isfinite(bpm[after]).mean() * 100), 1) if after.any() else None,
        "coverageFromStartPct": round(float(np.isfinite(bpm).mean() * 100), 1),
        "oursMeanBpm": round(float(np.mean([r["ours"] for r in rep])), 1) if rep else None,
        "refMeanBpm": round(float(np.mean([r["ref"] for r in rows])), 1) if rows else None,
        "deviceMeanBpm": round(float(np.mean([r["device"] for r in rows])), 1) if rows else None,
        "maeBpm": round(float(np.abs(err).mean()), 2) if rep else None,
        "rmseBpm": round(float(np.sqrt((err**2).mean())), 2) if rep else None,
        "within5Pct": round(float((np.abs(err) <= 5).mean() * 100), 1) if rep else None,
        "maeVsDeviceBpm": round(float(np.abs(errd).mean()), 2) if rep else None,
        "medianQuality": round(float(np.nanmedian(q[after])), 3) if after.any() else None,
        "medianGate": round(float(np.nanmedian(face[after, 11])), 3) if after.any() else None,
        "delegate": d["perf"]["delegate"],
        "windowRows": rows,
    }
    return out


def summarize(res):
    rows = [(r["subject"], w) for r in res for w in r["windowRows"]]
    rep = [(s, w) for s, w in rows if w["ours"] is not None]
    err = np.array([w["ours"] - w["ref"] for _, w in rep])
    errd = np.array([w["ours"] - w["device"] for _, w in rep])
    ours = np.array([w["ours"] for _, w in rep])
    ref = np.array([w["ref"] for _, w in rep])
    refd = np.array([w["ref"] - w["device"] for _, w in rows])
    sub_mae = [r["maeBpm"] for r in res if r["maeBpm"] is not None]
    secs = sum(r["evaluatedSeconds"] for r in res)
    w8 = sum(r["evaluatedSeconds"] - 8 for r in res)
    cov = sum((r["coveragePct"] or 0) * (r["evaluatedSeconds"] - 8) for r in res) / w8
    return {
        "subjects": len(res),
        "subjectsWithAnyBpm": len(sub_mae),
        "minutes": round(secs / 60, 1),
        "windows": len(rows),
        "windowsReported": len(rep),
        "windowCoveragePct": round(100 * len(rep) / max(1, len(rows)), 1),
        "coveragePct": round(cov, 1),
        "maeBpm": round(float(np.abs(err).mean()), 2),
        "rmseBpm": round(float(np.sqrt((err**2).mean())), 2),
        "within5Pct": round(float((np.abs(err) <= 5).mean() * 100), 1),
        "within3Pct": round(float((np.abs(err) <= 3).mean() * 100), 1),
        "medianAbsErrBpm": round(float(np.median(np.abs(err))), 2),
        "biasBpm": round(float(err.mean()), 2),
        "pearsonR": round(float(np.corrcoef(ours, ref)[0, 1]), 3),
        "maeSubjectMeanBpm": round(float(np.mean(sub_mae)), 2),
        "maeVsDeviceBpm": round(float(np.abs(errd).mean()), 2),
        "referenceVsDeviceMaeBpm": round(float(np.abs(refd).mean()), 2),
        "refRangeBpm": [round(float(ref.min()), 0), round(float(ref.max()), 0)],
        "pipelineFpsMedian": float(np.median([r["pipelineFps"] for r in res])),
        "pipelineFpsMeanMedian": float(np.median([r["pipelineFpsMean"] for r in res])),
    }


def main():
    raw, out = sys.argv[1], sys.argv[2]
    label = sys.argv[sys.argv.index("--label") + 1] if "--label" in sys.argv else os.path.basename(raw.rstrip("/"))
    res = []
    for p in sorted(glob.glob(f"{raw}/subject*.json"), key=lambda s: int(os.path.basename(s)[7:-5])):
        try:
            r = score(p)
        except Exception as e:  # noqa: BLE001
            print("skip", p, type(e).__name__, e, file=sys.stderr)
            continue
        r["build"] = label
        res.append(r)
    with open(out, "w") as f:
        for r in res:
            f.write(json.dumps(r) + "\n")
    print(f"{'subject':10} {'fps':>5} {'face%':>6} {'faceW':>5} {'luma':>4} {'win':>4} {'rep':>4} {'cov%':>5} {'ours':>6} {'ref':>6} {'dev':>6} {'MAE':>6} {'w5%':>5} {'q':>5} {'gate':>5}")
    for r in res:
        f = lambda v, n=1: "-" if v is None else f"{v:.{n}f}"  # noqa: E731
        print(f"{r['subject']:10} {r['pipelineFpsMean']:5.1f} {r['faceFoundPct']:6.1f} {f(r['faceWidthPx'],0):>5} {f(r['skinLuma'],0):>4} {r['windows']:4d} {r['windowsReported']:4d} {f(r['coveragePct']):>5} {f(r['oursMeanBpm']):>6} {f(r['refMeanBpm']):>6} {f(r['deviceMeanBpm']):>6} {f(r['maeBpm'],2):>6} {f(r['within5Pct']):>5} {f(r['medianQuality'],2):>5} {f(r['medianGate'],2):>5}")
    s = summarize(res)
    s["build"] = label
    print(json.dumps(s, indent=1))
    with open(out.replace(".jsonl", "") + ".summary.json", "w") as f:
        json.dump(s, f, indent=1)


if __name__ == "__main__":
    main()
