#!/usr/bin/env python3
"""Score smile and face detection on the hand-labelled clips.

    python3 -I validation/score_smile.py <raw_dir> <out.jsonl> [--label v1]

Labels: smile_labels_by_sheet.txt (six frames per clip, labelled by eye before any score was seen) joined with
/bulk2/runs/depression/validation/smile/sheets/sheets.json (which clip and which frame numbers each row is).
The pipeline's score at a labelled frame is the median `smile` over the samples it emitted within +-2 video
frames of it (frames are matched by the stamp in the corner); if it found no face there, the frame counts as
"face missing" (and as a missed smile for S frames).

Decided before looking at scores:
  detected            smile score >= 0.15: the app's own onset step (SMILE_ONSET_DELTA in features.ts) over a zero
                      resting level. The threshold-free AUC and a threshold sweep are reported next to it.
  sensitivity         share of S frames (clear smile or laugh) detected
  false positives     share of N frames (neutral, serious, talking, thinking) detected
  subtle              s frames, reported on their own, in neither number
  clip level          smiling clip = at least 2 S frames, detected when the median score of its S frames >= 0.15;
                      neutral clip = no S or s frame and at least 3 N frames, false positive when any N frame >= 0.15
  own range           for people with at least 2 N and 2 S frames: each frame's score rescaled with that person's
                      rest (median of their OTHER N frames) and max (highest of their OTHER S frames), the same
                      formula as Sense.setCalibration. Leave-one-out, so a frame never calibrates itself.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/bulk2/runs/depression/validation/smile"
THR = 0.15
YAW_MAX = 20
FACE_MIN_PX = 100


def load_labels():
    with open(f"{ROOT}/sheets/sheets.json") as f:
        sheets = {f"{r['sheet']}.{r['row']}": r for r in json.load(f)}
    out = {}
    with open(f"{HERE}/smile_labels_by_sheet.txt") as f:
        for ln in f:
            if ln.startswith("#") or not ln.strip():
                continue
            p = [x.strip() for x in ln.split("|")]
            row = sheets[p[0]]
            assert len(p[2]) == 6, ln
            out[row["id"]] = {"id": row["id"], "sheetRow": p[0], "person": p[1], "frames": row["frames"], "labels": p[2], "skin": p[3], "age": p[4], "glasses": p[5] == "yes", "beard": p[6] == "yes", "pose": p[7], "light": p[8], "note": p[9] if len(p) > 9 else ""}
    return out


def auc(pos, neg):
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    if len(pos) == 0 or len(neg) == 0:
        return None
    allv = np.concatenate([pos, neg])
    order = allv.argsort()
    ranks = np.empty(len(allv))
    ranks[order] = np.arange(1, len(allv) + 1)
    # average ranks for ties
    for v in np.unique(allv):
        m = allv == v
        if m.sum() > 1:
            ranks[m] = ranks[m].mean()
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def pct(a, b):
    return None if b == 0 else round(100 * a / b, 1)


def score_clip(path, lab):
    with open(path) as f:
        d = json.load(f)
    face = [r for r in d["face"] if r[1] is not None and r[1] >= 0 and r[2] == 0]
    k = np.array([r[1] for r in face])
    present = np.array([r[3] for r in face]) == 1
    smile = np.array([r[4] or 0 for r in face], float)
    yaw = np.array([abs(r[9] or 0) for r in face], float)
    fwid = np.array([r[16] or 0 for r in face], float)
    warp = d.get("warp", 1)
    frames = []
    for kk, lb in zip(lab["frames"], lab["labels"]):
        near = np.abs(k - kk) <= 2
        seen = near & present
        frames.append({
            "k": kk, "label": lb, "analysed": bool(near.any()), "face": bool(seen.any()),
            "smile": round(float(np.median(smile[seen])), 3) if seen.any() else None,
            "yaw": round(float(np.median(yaw[seen])), 1) if seen.any() else None,
            "faceW": round(float(np.median(fwid[seen]))) if seen.any() else None,
        })
    usable = [f for f in frames if f["label"] != "X" and f["analysed"]]
    pres = present & True
    fw = [r[16] for r in face if r[3] == 1 and r[16]]
    luma = [0.299 * r[13] + 0.587 * r[14] + 0.114 * r[15] for r in face if r[3] == 1 and r[13] is not None]
    mm = [r[19] * warp for r in face if r[19] is not None]
    n_frames = d["job"]["frames"]
    seen_frames = len(set(k.tolist()))
    S = [f for f in frames if f["label"] == "S" and f["analysed"]]
    N = [f for f in frames if f["label"] == "N" and f["analysed"]]
    sub = [f for f in frames if f["label"] == "s" and f["analysed"]]
    sv = [f["smile"] if f["smile"] is not None else 0.0 for f in S]
    nv = [f["smile"] for f in N if f["smile"] is not None]
    kind = "smiling" if len([f for f in frames if f["label"] == "S"]) >= 2 else ("neutral" if not S and not sub and "s" not in lab["labels"] and len([f for f in frames if f["label"] == "N"]) >= 3 else ("excluded" if set(lab["labels"]) == {"X"} else "mixed"))
    return {
        "clip": lab["id"],
        "source": f"https://mixkit.co/free-stock-video/{slug(lab['id'])}-{lab['id']}/",
        "person": lab["person"],
        "labels": lab["labels"],
        "labelFrames": lab["frames"],
        "skin": lab["skin"], "age": lab["age"], "glasses": lab["glasses"], "beard": lab["beard"], "pose": lab["pose"], "light": lab["light"], "note": lab["note"],
        "clipKind": kind,
        "faceFoundPct": pct(int(pres.sum()), len(face)),
        "faceFoundOnLabelledPct": pct(sum(1 for f in usable if f["face"]), len(usable)),
        "faceWidthPx": round(float(np.median(fw))) if fw else None,
        "frameWidthPx": int(d["perf"]["video"].split("x")[0]),
        "skinLuma": round(float(np.median(luma))) if luma else None,
        "framesAnalysedPct": pct(seen_frames, n_frames),
        "modelMsMedian": round(float(np.median(mm)), 1) if mm else None,
        "smileAtFrames": [f["smile"] for f in frames],
        "analysedAtFrames": [f["analysed"] for f in frames],
        "absYawAtFrames": [f["yaw"] for f in frames], "faceWidthAtFrames": [f["faceW"] for f in frames],
        "sFrames": len(S), "sDetected": sum(1 for v in sv if v >= THR), "sFaceMissing": sum(1 for f in S if f["smile"] is None),
        "nFrames": len(nv), "nDetected": sum(1 for v in nv if v >= THR), "nFaceMissing": len(N) - len(nv),
        "subtleFrames": len(sub), "subtleDetected": sum(1 for f in sub if (f["smile"] or 0) >= THR),
        "smileMedianOnS": round(float(np.median(sv)), 3) if sv else None,
        "smileMaxOnN": round(float(max(nv)), 3) if nv else None,
        "smileP95Clip": round(float(np.percentile(smile[present], 95)), 3) if present.any() else None,
        "smileP05Clip": round(float(np.percentile(smile[present], 5)), 3) if present.any() else None,
    }


_slugs = None


def slug(vid):
    global _slugs
    if _slugs is None:
        with open(f"{ROOT}/candidates.json") as f:
            _slugs = {c["id"]: c["slug"] for c in json.load(f)}
    return _slugs.get(vid, "")


def summarize(res, label):
    use = [r for r in res if r["clipKind"] != "excluded"]

    def agg(rows):
        s = sum(r["sFrames"] for r in rows)
        sd = sum(r["sDetected"] for r in rows)
        n = sum(r["nFrames"] for r in rows)
        nd = sum(r["nDetected"] for r in rows)
        sub = sum(r["subtleFrames"] for r in rows)
        subd = sum(r["subtleDetected"] for r in rows)
        lab_frames = sum(sum(1 for c, a in zip(r["labels"], r["analysedAtFrames"]) if c != "X" and a) for r in rows)
        lab_found = sum(sum(1 for c, a, v in zip(r["labels"], r["analysedAtFrames"], r["smileAtFrames"]) if c != "X" and a and v is not None) for r in rows)
        return {
            "clips": len(rows), "people": len({r["person"] for r in rows}),
            "faceFoundPct": round(float(np.mean([r["faceFoundPct"] or 0 for r in rows])), 1) if rows else None,
            "faceFoundOnLabelledPct": pct(lab_found, lab_frames),
            "clipsFaceUnder90Pct": sum(1 for r in rows if (r["faceFoundPct"] or 0) < 90),
            "sFrames": s, "sensitivityPct": pct(sd, s), "sFaceMissing": sum(r["sFaceMissing"] for r in rows),
            "nFrames": n, "falsePositivePct": pct(nd, n),
            "subtleFrames": sub, "subtleDetectedPct": pct(subd, sub),
        }

    # a clear-smile frame the pipeline looked at but found no face in is a miss (score 0); frames it never
    # looked at (before the model had loaded) are left out
    S = [v if v is not None else 0.0 for r in use for v, c, a in zip(r["smileAtFrames"], r["labels"], r["analysedAtFrames"]) if c == "S" and a]
    N = [v for r in use for v, c in zip(r["smileAtFrames"], r["labels"]) if c == "N" and v is not None]
    sub = [v for r in use for v, c in zip(r["smileAtFrames"], r["labels"]) if c == "s" and v is not None]
    out = {"build": label, "threshold": THR, "all": agg(use), "excludedClips": len(res) - len(use)}
    out["all"]["aucSvsN"] = round(auc(S, N), 3)
    out["all"]["scoreOnS"] = [round(float(x), 3) for x in np.percentile(S, [10, 50, 90])]
    out["all"]["scoreOnN"] = [round(float(x), 3) for x in np.percentile(N, [10, 50, 90])]
    out["all"]["scoreOnSubtle"] = [round(float(x), 3) for x in np.percentile(sub, [10, 50, 90])] if sub else None
    # the framing the app should ask for (README "Thresholds"): head within 20 degrees of the camera, face 100 px wide
    def framed(inside):
        s_, n_ = [], []
        for r in use:
            for v, c, a, y, w in zip(r["smileAtFrames"], r["labels"], r["analysedAtFrames"], r["absYawAtFrames"], r["faceWidthAtFrames"]):
                if not a or v is None or c not in "SN":
                    continue
                if (y < YAW_MAX and w >= FACE_MIN_PX) == inside:
                    (s_ if c == "S" else n_).append(v)
        return {"sFrames": len(s_), "sensitivityPct": pct(sum(1 for v in s_ if v >= THR), len(s_)), "nFrames": len(n_), "falsePositivePct": pct(sum(1 for v in n_ if v >= THR), len(n_)), "auc": round(auc(s_, n_), 3) if s_ and n_ else None}

    out["wellFramed"] = {"absYawUnderDeg": YAW_MAX, "faceWidthAtLeastPx": FACE_MIN_PX, "inside": framed(True), "outside": framed(False)}
    out["sweep"] = [{"threshold": t, "sensitivityPct": pct(sum(1 for v in S if v >= t), len(S)), "falsePositivePct": pct(sum(1 for v in N if v >= t), len(N))} for t in (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5)]
    sm = [r for r in use if r["clipKind"] == "smiling"]
    ne = [r for r in use if r["clipKind"] == "neutral"]
    out["clipLevel"] = {
        "smilingClips": len(sm), "smilingPeople": len({r["person"] for r in sm}),
        "sensitivityPct": pct(sum(1 for r in sm if (r["smileMedianOnS"] or 0) >= THR), len(sm)),
        "neutralClips": len(ne), "neutralPeople": len({r["person"] for r in ne}),
        "falsePositivePct": pct(sum(1 for r in ne if (r["smileMaxOnN"] or 0) >= THR), len(ne)),
        "mixedClips": len(use) - len(sm) - len(ne),
    }
    groups = {}
    for key, vals in (("skin", ["light", "medium", "dark"]), ("age", ["child", "adult", "older"]), ("glasses", [True, False]), ("beard", [True, False]), ("pose", ["front", "notFront"]), ("light", ["normal", "notNormal"])):
        for v in vals:
            if key == "pose":
                rows = [r for r in use if (r["pose"] == "front") == (v == "front")]
            elif key == "light":
                rows = [r for r in use if (r["light"] == "normal") == (v == "normal")]
            else:
                rows = [r for r in use if r[key] == v]
            groups[f"{key}={v}"] = agg(rows)
    out["groups"] = groups

    # per-person calibration, leave-one-out
    people = {}
    for r in use:
        for v, c in zip(r["smileAtFrames"], r["labels"]):
            if c in "SN" and v is not None:
                people.setdefault(r["person"], []).append((c, v))
    raw_s, raw_n, cal_s, cal_n = [], [], [], []
    rests, maxes = [], []
    n_people = 0
    for p, fr in people.items():
        s_idx = [i for i, (c, _) in enumerate(fr) if c == "S"]
        n_idx = [i for i, (c, _) in enumerate(fr) if c == "N"]
        if len(s_idx) < 2 or len(n_idx) < 2:
            continue
        n_people += 1
        rests.append(float(np.median([fr[i][1] for i in n_idx])))
        maxes.append(float(max(fr[i][1] for i in s_idx)))
        for i, (c, v) in enumerate(fr):
            rest = float(np.median([fr[j][1] for j in n_idx if j != i]))
            mx = float(max(fr[j][1] for j in s_idx if j != i))
            span = mx - rest
            own = v if not span > 0.03 else max(0.0, min(1.25, (v - rest) / span))
            (raw_s if c == "S" else raw_n).append(v)
            (cal_s if c == "S" else cal_n).append(own)

    def best_acc(s, n):
        best = (0, 0)
        for t in sorted(set(s + n)):
            a = (sum(1 for v in s if v >= t) + sum(1 for v in n if v < t)) / (len(s) + len(n))
            if a > best[0]:
                best = (a, t)
        return round(100 * best[0], 1), round(best[1], 3)

    def at(s, n, t):
        return {"threshold": t, "sensitivityPct": pct(sum(1 for v in s if v >= t), len(s)), "falsePositivePct": pct(sum(1 for v in n if v >= t), len(n))}

    if n_people:
        out["ownRange"] = {
            "people": n_people, "sFrames": len(raw_s), "nFrames": len(raw_n),
            "rawAuc": round(auc(raw_s, raw_n), 3), "ownAuc": round(auc(cal_s, cal_n), 3),
            "rawAt015": at(raw_s, raw_n, 0.15), "ownAtHalf": at(cal_s, cal_n, 0.5), "ownAtThird": at(cal_s, cal_n, 0.33),
            "rawBestAccuracyPct": best_acc(raw_s, raw_n)[0], "rawBestThreshold": best_acc(raw_s, raw_n)[1],
            "ownBestAccuracyPct": best_acc(cal_s, cal_n)[0], "ownBestThreshold": best_acc(cal_s, cal_n)[1],
            "restRawAcrossPeople": [round(x, 3) for x in (min(rests), float(np.median(rests)), max(rests))],
            "maxRawAcrossPeople": [round(x, 3) for x in (min(maxes), float(np.median(maxes)), max(maxes))],
        }
    # resting level only (what a ping already does: its smile numbers are measured above the level in the settle
    # phase). People with at least 3 no-smile frames; each frame against the median of the person's other
    # no-smile frames.
    rn_raw, rn_rel, rs_raw, rs_rel, rest_people = [], [], [], [], 0
    for p, fr in people.items():
        nvals = [v for c, v in fr if c == "N"]
        if len(nvals) < 3:
            continue
        rest_people += 1
        for i, v in enumerate(nvals):
            rn_raw.append(v)
            rn_rel.append(v - float(np.median(nvals[:i] + nvals[i + 1:])))
        for c, v in fr:
            if c == "S":
                rs_raw.append(v)
                rs_rel.append(v - float(np.median(nvals)))
    out["ownRest"] = {
        "people": rest_people, "nFrames": len(rn_raw), "sFrames": len(rs_raw),
        "rawFalsePositivePct": pct(sum(1 for v in rn_raw if v >= THR), len(rn_raw)),
        "aboveOwnRestFalsePositivePct": pct(sum(1 for v in rn_rel if v >= THR), len(rn_rel)),
        "rawSensitivityPct": pct(sum(1 for v in rs_raw if v >= THR), len(rs_raw)),
        "aboveOwnRestSensitivityPct": pct(sum(1 for v in rs_rel if v >= THR), len(rs_rel)),
        "peopleRestingAbove010": sum(1 for p, fr in people.items() if len([v for c, v in fr if c == "N"]) >= 3 and float(np.median([v for c, v in fr if c == "N"])) >= 0.10),
    }

    # how much of the spread in the score of a clear smile is between people (the part a per-person scale removes)
    all_s = {}
    for r in use:
        for v, c, a in zip(r["smileAtFrames"], r["labels"], r["analysedAtFrames"]):
            if c == "S" and a and v is not None:
                all_s.setdefault(r["person"], []).append(v)
    multi = {p: v for p, v in all_s.items() if len(v) >= 3}
    if len(multi) >= 3:
        allv = np.concatenate([np.asarray(v) for v in multi.values()])
        within = sum(float(((np.asarray(v) - np.mean(v)) ** 2).sum()) for v in multi.values())
        total = float(((allv - allv.mean()) ** 2).sum())
        loo = {p: [x / max(v[:i] + v[i + 1:]) for i, x in enumerate(v)] for p, v in multi.items()}
        raw_med = np.array([np.median(v) for v in multi.values()])
        loo_med = np.array([np.median(v) for v in loo.values()])
        out["clearSmileSpread"] = {
            "people": len(multi), "frames": int(len(allv)),
            "betweenPeopleSharePct": round(100 * (1 - within / total), 1),
            "rawPersonMedian": {"min": round(float(raw_med.min()), 3), "max": round(float(raw_med.max()), 3), "sd": round(float(raw_med.std()), 3)},
            "scaledToOwnOtherFramesPersonMedian": {"min": round(float(loo_med.min()), 3), "max": round(float(loo_med.max()), 3), "sd": round(float(loo_med.std()), 3)},
            "peopleWhoseClearSmileStaysUnder06": int((raw_med < 0.6).sum()),
        }
    med = sorted(float(np.median(v)) for v in all_s.values())
    out["clearSmileScoreAcrossPeople"] = {"people": len(med), "min": round(med[0], 3), "p25": round(float(np.percentile(med, 25)), 3), "median": round(float(np.median(med)), 3), "p75": round(float(np.percentile(med, 75)), 3), "max": round(med[-1], 3)}
    mm = [r["modelMsMedian"] for r in use if r["modelMsMedian"]]
    out["modelMsMedian"] = round(float(np.median(mm)), 1) if mm else None
    out["framesAnalysedPct"] = round(float(np.median([r["framesAnalysedPct"] for r in use])), 1)
    return out


def main():
    raw, outp = sys.argv[1], sys.argv[2]
    label = sys.argv[sys.argv.index("--label") + 1] if "--label" in sys.argv else os.path.basename(raw.rstrip("/"))
    labels = load_labels()
    res = []
    for vid, lab in sorted(labels.items(), key=lambda kv: int(kv[0])):
        p = f"{raw}/{vid}.json"
        if not os.path.exists(p):
            print("no run for", vid, file=sys.stderr)
            continue
        r = score_clip(p, lab)
        r["build"] = label
        res.append(r)
    with open(outp, "w") as f:
        for r in res:
            f.write(json.dumps(r) + "\n")
    s = summarize(res, label)
    with open(outp.replace(".jsonl", "") + ".summary.json", "w") as f:
        json.dump(s, f, indent=1)
    if "--quiet" not in sys.argv:
        for r in res:
            print(f"{r['clip']:>7} {r['person']} {r['labels']} {r['clipKind']:8} face {r['faceFoundPct']:5} fw {str(r['faceWidthPx']):>4} " + " ".join("  -  " if v is None else f"{v:5.2f}" for v in r["smileAtFrames"]) + f"  {r['skin'][:3]} {r['pose'][:5]} {r['light'][:5]}")
    print(json.dumps(s, indent=1))


if __name__ == "__main__":
    main()
