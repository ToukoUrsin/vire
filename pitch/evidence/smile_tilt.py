"""Is the smile the AirPods feel the earbud moving, or only the head dipping?

    python3 pitch/evidence/smile_tilt.py <chart.png> <minute.json> [<minute.json> ...]

A teaching minute holds the AirPods' angles (50 a second) next to what the camera saw: a smile level and the
head's own pitch, yaw and roll. In the nod and the head shake of each minute the head truly moves, so those
parts give the map from "head movement as the camera sees it" to "what the AirPods then feel". For every smile
the map says how much AirPods tilt the head movement accounts for. What the AirPods tilted beyond that is the
earbud moving in the ear.

Prints the numbers as JSON and draws one chart. Nothing here is fitted to the smiles themselves.
"""
from __future__ import annotations

import json
import sys

import numpy as np

STEP = 20.0  # ms: both streams are laid on one 50 Hz grid


def unwrap(v: np.ndarray) -> np.ndarray:
    return np.degrees(np.unwrap(np.radians(v)))


def minute(path: str) -> dict:
    j = json.load(open(path))
    r = j.get("recording", j)
    head = np.array(r["head"], float)
    face = np.array(r["face"], float)
    face = face[face[:, 1] > 0.5]
    ht, ft = head[:, 0], face[:, 0]
    t = np.arange(max(ht[0], ft[0]), min(ht[-1], ft[-1]), STEP)
    air = np.stack([np.interp(t, ht, head[:, 1]), np.interp(t, ht, unwrap(head[:, 2])), np.interp(t, ht, head[:, 3])], 1)
    steps = r["steps"]
    inside = lambda asks: np.array([any(s["ask"] in asks and s["t0"] + 300 <= x < s["t1"] for s in steps) for x in t])
    moving = inside(("nod", "shake"))
    # the camera runs a little behind the AirPods: the shift that lines the nods up best
    nod = inside(("nod",))
    cam_at = lambda lag: np.stack([np.interp(t + lag, ft, face[:, 6]), np.interp(t + lag, ft, unwrap(face[:, 7])), np.interp(t + lag, ft, face[:, 8])], 1)
    lag = 0.0
    if nod.sum() > 50:
        lag = max(range(-200, 201, 20), key=lambda g: abs(np.corrcoef(cam_at(g)[nod, 0], air[nod, 0])[0, 1]))
    cam = cam_at(lag)
    smile = np.interp(t + lag, ft, face[:, 2])
    return {"t": t, "air": air, "cam": cam, "smile": smile, "steps": steps, "moving": moving, "lag": lag, "path": path}


def head_map(ms: list[dict]) -> tuple[np.ndarray, dict]:
    """camera (pitch, yaw, roll) -> AirPods (pitch, yaw, roll), from every nod and head shake"""
    xs, ys = [], []
    for m in ms:
        for s in m["steps"]:
            if s["ask"] not in ("nod", "shake"):
                continue
            k = (m["t"] >= s["t0"] + 300) & (m["t"] < s["t1"])
            if k.sum() < 30:
                continue
            xs.append(m["cam"][k] - m["cam"][k].mean(0))
            ys.append(m["air"][k] - m["air"][k].mean(0))
    x, y = np.vstack(xs), np.vstack(ys)
    w, *_ = np.linalg.lstsq(x, y, rcond=None)
    fit = 1 - ((y - x @ w) ** 2).sum(0) / (y ** 2).sum(0)
    return w, {"samples": int(len(x)), "pitch_fit": round(float(fit[0]), 2)}


def bouts(m: dict) -> list[tuple[float, float]]:
    """smiles as the camera saw them: the level above half of this minute's own top for at least 0.8 s"""
    t, s = m["t"], m["smile"]
    asked = np.array([any(z["ask"] in ("smile", "relax") and z["t0"] <= x < z["t1"] for z in m["steps"]) for x in t])
    top = np.percentile(s[asked], 95) if asked.any() else 0
    if top < 0.2:
        return []
    on = (s > 0.5 * top) & asked
    out, i = [], 0
    while i < len(t):
        if not on[i]:
            i += 1
            continue
        j = i
        while j < len(t) and (on[j] or (j + 20 < len(t) and on[j:j + 20].any())):  # a dip under 0.4 s is the same smile
            j += 1
        if t[j - 1] - t[i] >= 800:
            out.append((t[i], t[j - 1]))
        i = j
    return out


def shift(m: dict, a0: float, a1: float, b0: float, b1: float) -> tuple[np.ndarray, np.ndarray] | None:
    """how the AirPods' and the camera's angles changed from one stretch to a later one"""
    t = m["t"]
    a, b = (t >= a0) & (t < a1), (t >= b0) & (t < b1)
    if a.sum() < 15 or b.sum() < 15:
        return None
    return m["air"][b].mean(0) - m["air"][a].mean(0), m["cam"][b].mean(0) - m["cam"][a].mean(0)


def main() -> int:
    chart, paths = sys.argv[1], sys.argv[2:]
    ms = [minute(p) for p in paths]
    w, fit = head_map(ms)
    smiles, still = [], []
    for m in ms:
        top = np.percentile(m["smile"], 95)
        for on, off in bouts(m):
            got = shift(m, on - 1200, on - 300, on + 500, min(off - 100, on + 2500))
            if got:
                smiles.append((got[0], got[1] @ w))
            # the same measure a second earlier, where nothing happens: no smile, no asked movement
            quiet = (m["t"] >= on - 2000) & (m["t"] < on - 200)
            if quiet.sum() > 60 and m["smile"][quiet].max() < 0.2 * top and not m["moving"][quiet].any():
                got = shift(m, on - 2000, on - 1100, on - 1100, on - 200)
                if got:
                    still.append((got[0], got[1] @ w))
    if not smiles:
        print(json.dumps({"error": "no smiles in these minutes"}))
        return 1
    air = np.array([s[0] for s in smiles])
    head = np.array([s[1] for s in smiles])
    left = air - head
    across = lambda v: np.hypot(v[:, 1], v[:, 2])
    q_air = np.array([s[0] for s in still]).reshape(-1, 3)
    q_head = np.array([s[1] for s in still]).reshape(-1, 3)
    q_left = q_air - q_head
    floor = float(np.percentile(across(q_left), 95)) if len(q_left) >= 5 else float(across(q_left).max()) if len(q_left) else 0.0
    # is what is left the same movement every time? each smile against the direction of all the others
    same = 0
    for k in range(len(left)):
        rest = np.delete(left, k, 0).mean(0)
        same += bool(len(left) > 1 and left[k] @ rest > 0)
    med = lambda v: round(float(np.median(v)), 2)
    out = {
        "minutes": len(ms), "smiles": len(smiles), "still_stretches": len(still),
        "map": {"from_nods_and_shakes": fit, "airpods_pitch_per_head_pitch": round(float(w[0, 0]), 2)},
        "pitch": {"airpods_median": med(air[:, 0]), "head_accounts_for_median": med(head[:, 0]), "left_median": med(left[:, 0])},
        "across": {
            "airpods_median": med(across(air)), "head_accounts_for_median": med(across(head)), "left_median": med(across(left)),
            "still_left_median": med(across(q_left)) if len(q_left) else None, "still_left_95th": round(floor, 2),
            "smiles_above_still": int((across(left) > floor).sum()),
        },
        "left_same_direction": same,
        "mean_left_pitch_yaw_roll": [round(float(v), 2) for v in left.mean(0)],
    }
    print(json.dumps(out, indent=1))
    draw(chart, air, head, q_air, q_head, out)
    return 0


def draw(path: str, air: np.ndarray, head: np.ndarray, q_air: np.ndarray, q_head: np.ndarray, out: dict) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ink, soft, faint = "#0b0b0b", "#52514e", "#d9d8d3"
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "text.color": ink, "axes.labelcolor": soft, "xtick.color": soft, "ytick.color": soft})
    fig, axes = plt.subplots(1, 2, figsize=(10.4, 5.8), dpi=200)
    fig.patch.set_facecolor("white")
    across = lambda v: np.hypot(v[:, 1], v[:, 2])
    panels = [
        ("Nodding (pitch)", np.abs(head[:, 0]), np.abs(air[:, 0]), np.abs(q_head[:, 0]), np.abs(q_air[:, 0]), "A head dip explains it: on or under the line"),
        ("Turning and tilting (yaw, roll)", across(head), across(air), across(q_head), across(q_air), "The head did not move this way. The AirPods did."),
    ]
    top = max(1.0, float(max(np.abs(air[:, 0]).max(), across(air).max(), np.abs(head[:, 0]).max()))) * 1.15
    for ax, (title, x, y, qx, qy, note) in zip(axes, panels):
        ax.set_facecolor("white")
        ax.plot([0, top], [0, top], color=soft, lw=1.2, ls=(0, (4, 3)), zorder=1)
        ax.text(top * 0.8, top * 0.775, "only the head moving", color=soft, fontsize=9.5, ha="center", va="top", rotation=45, rotation_mode="anchor")
        if len(qx):
            ax.scatter(qx, qy, s=46, facecolors="white", edgecolors=soft, linewidths=1.3, zorder=2, label="no smile")
        ax.scatter(x, y, s=64, color=ink, edgecolors="white", linewidths=1.5, zorder=3, label="a smile")
        ax.set_xlim(0, top)
        ax.set_ylim(0, top)
        ax.set_aspect("equal")
        ax.set_title(title, loc="left", fontsize=12.5, fontweight="bold", pad=22)
        ax.text(0, 1.025, note, transform=ax.transAxes, fontsize=10, color=soft, va="bottom")
        ax.set_xlabel("Head movement the camera saw, as AirPods tilt (degrees)")
        ax.grid(color=faint, lw=0.7)
        ax.set_axisbelow(True)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        for side in ("left", "bottom"):
            ax.spines[side].set_color(faint)
        ax.tick_params(length=0)
    axes[0].set_ylabel("AirPods tilt during the smile (degrees)")
    axes[1].legend(loc="lower right", frameon=False, fontsize=10, handletextpad=0.3)
    fig.suptitle(f"What the AirPods felt in {out['smiles']} smiles, against how the head moved", x=0.07, ha="left", fontsize=14.5, fontweight="bold", y=0.975)
    fig.subplots_adjust(left=0.07, right=0.985, bottom=0.115, top=0.8, wspace=0.14)
    fig.savefig(path, facecolor="white")


if __name__ == "__main__":
    raise SystemExit(main())
