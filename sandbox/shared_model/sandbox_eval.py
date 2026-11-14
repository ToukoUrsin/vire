"""Conditions (b), (c), (d) for one person, inside a network-blocked Modal Sandbox, on (a)'s own held-out windows.

stdin: {"shared": <pretrained weights>, "minutes": [teaching minutes, oldest first, each with `_labels` per AirPods
        row from web/src/tune/ear/labels.ts], "held": <condition (a)'s held-out answers from search_keep.py>}
stdout: one JSON line with every condition's held-out AUC per event, on exactly the same windows.

The fine-tuning recipe is fixed here before any result was seen and is the same for (b) and (d):
the pretrained conv layers plus a new three-output head (smile, nod, shake) that starts from the pretrained
lip-puller, nod and shake outputs; 400 steps of 64 windows, AdamW (conv 3e-4, head 3e-3), each event's
positives and negatives weighted equally, windows the camera could not label left out; three seeds, answers
averaged. Nothing is chosen on the held-out minute.
(b) taught on every other minute, asked about the one left out.
(c) not taught at all: the pretrained lip-puller, nod and shake probabilities, as a new user would get.
(d) taught on the first 32.5 s of one other minute only (the minute recorded just before the held-out one; for
    the earliest minute, the one just after), asked about the held-out minute.
"""
from __future__ import annotations

import json
import sys
import time

import numpy as np

import model as M

STEPS = 400
BATCH = 64
SEEDS = (0, 1, 2)
HALF_MS = 32500
GRID_MS = 100


def per_minute(rec: dict) -> dict:
    head = [r for r in rec["head"] if len(r) >= 10]
    order = np.argsort([r[0] for r in head], kind="mergesort")
    ts_all = np.asarray([head[i][0] for i in order], np.float64)
    six = np.nan_to_num(np.asarray([[head[i][c] for c in (4, 5, 6, 7, 8, 9)] for i in order], np.float64))
    # labels are per original head row; head rows with fewer than 10 fields are not expected in iPhone minutes
    lab_rows = {e: np.asarray(rec["_labels"][e], np.float32) for e in M.EVENTS}
    labs = {e: v[order] if len(v) == len(head) else np.full(len(head), -1, np.float32) for e, v in lab_rows.items()}
    return {"ts": ts_all, "six": six, "labels": labs, "steps": rec["steps"]}


def label_at(mm: dict, ends: np.ndarray) -> dict:
    ix = np.clip(np.searchsorted(mm["ts"], ends), 0, len(mm["ts"]) - 1)
    left = np.maximum(0, ix - 1)
    ix = np.where(np.abs(mm["ts"][left] - ends) <= np.abs(mm["ts"][ix] - ends), left, ix)
    return {e: mm["labels"][e][ix] for e in M.EVENTS}


def train_windows(mm: dict, until_ms: float | None = None):
    t0 = mm["ts"][0]
    last = mm["ts"][-1] if until_ms is None else min(mm["ts"][-1], t0 + until_ms)
    ends = np.arange(t0 + M.SECONDS * 1000, last + 1e-9, GRID_MS)
    return M.vire_windows(mm["ts"], mm["six"], ends), label_at(mm, ends)


def finetune(shared: dict, x: np.ndarray, ys: dict, seed: int):
    import torch
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    net = M.load_state(shared)
    classes = shared["classes"]
    old = net.head
    head = torch.nn.Linear(old.in_features, len(M.EVENTS))
    with torch.no_grad():
        for j, e in enumerate(M.EVENTS):
            c = classes.index(M.EARSET_FOR[e])
            head.weight[j] = old.weight[c]; head.bias[j] = old.bias[c]
    net.head = head
    z = torch.tensor(M.normalize(x, shared["mean"], shared["scale"]))
    y = np.stack([ys[e] for e in M.EVENTS], 1).astype(np.float32)
    known = y >= 0
    w = np.zeros_like(y)
    for j in range(y.shape[1]):
        k = known[:, j]; pos = (y[:, j] > 0.5) & k; neg = k & ~pos
        if pos.any() and neg.any():
            w[pos, j] = k.sum() / (2 * pos.sum()); w[neg, j] = k.sum() / (2 * neg.sum())
    yt = torch.tensor(np.where(y > 0.5, 1.0, 0.0).astype(np.float32)); wt = torch.tensor(w)
    convs = [*net.c1.parameters(), *net.c2.parameters()]
    opt = torch.optim.AdamW([{"params": convs, "lr": 3e-4}, {"params": head.parameters(), "lr": 3e-3}], weight_decay=1e-3)
    net.train()
    for _ in range(STEPS):
        j = torch.randint(0, len(z), (BATCH,), generator=gen)
        xb = M.augment(z[j], gen, flips=False, rotate_deg=10)
        loss = torch.nn.functional.binary_cross_entropy_with_logits(net(xb), yt[j], weight=wt[j])
        opt.zero_grad(); loss.backward(); opt.step()
    net.eval()
    return net


def answers(net, shared: dict, x: np.ndarray, pretrained: bool) -> dict:
    import torch
    with torch.no_grad():
        out = net(torch.tensor(M.normalize(x, shared["mean"], shared["scale"])))
    if pretrained:
        pr = torch.softmax(out, 1).numpy()
        return {e: pr[:, shared["classes"].index(M.EARSET_FOR[e])] for e in M.EVENTS}
    pr = torch.sigmoid(out).numpy()
    return {e: pr[:, j] for j, e in enumerate(M.EVENTS)}


def episodes(steps: list, event: str, t: np.ndarray, y: np.ndarray) -> int:
    """Separate times the thing happened, counted as the product does: an asked-for bout with at least two
    positive windows inside it (or up to 0.7 s after)."""
    n = 0
    for s in steps:
        if s["ask"] == event and int(((y > 0.5) & (t >= s["t0"]) & (t < s["t1"] + 700)).sum()) >= 2:
            n += 1
    return n


def main() -> None:
    import torch
    torch.set_num_threads(4)
    started = time.time()
    inp = json.load(sys.stdin)
    shared, held = inp["shared"], inp["held"]
    mins = [per_minute(r) for r in inp["minutes"]]
    n = len(mins)

    # the common windows: (a)'s held-out windows that have 2 s of motion behind them
    test = {}
    for e in M.EVENTS:
        h = held[e]
        m = np.asarray(h["m"]); t = np.asarray(h["t"], np.float64); y = np.asarray(h["y"]); pa = np.asarray(h["p"])
        start = np.asarray([mins[k]["ts"][0] for k in m]) if len(m) else np.zeros(0)
        keep = t - (M.LEN - 1) * (1000.0 / M.HZ) >= start
        test[e] = {"m": m[keep], "t": t[keep], "y": y[keep], "a": pa[keep], "all": {"auc": M.auc(y, pa), "windows": int(len(y))}}
    xs = {k: {e: M.vire_windows(mins[k]["ts"], mins[k]["six"], test[e]["t"][test[e]["m"] == k]) for e in M.EVENTS} for k in range(n)}

    pre = M.load_state(shared); pre.eval()
    preds = {c: {e: np.zeros(len(test[e]["y"])) for e in M.EVENTS} for c in ("b", "c", "d")}
    for k in range(n):
        for e in M.EVENTS:
            sel = test[e]["m"] == k
            if sel.any():
                preds["c"][e][sel] = answers(pre, shared, xs[k][e], True)[e]
        tw = [train_windows(mins[j]) for j in range(n) if j != k]
        xb = np.concatenate([a for a, _ in tw]); yb = {e: np.concatenate([b[e] for _, b in tw]) for e in M.EVENTS}
        src = k - 1 if k > 0 else 1
        xd, yd = train_windows(mins[src], HALF_MS)
        for cond, (x, ys) in (("b", (xb, yb)), ("d", (xd, yd))):
            acc = {e: np.zeros(int((test[e]["m"] == k).sum())) for e in M.EVENTS}
            for seed in SEEDS:
                net = finetune(shared, x, ys, seed + 100 * k)
                for e in M.EVENTS:
                    if len(acc[e]):
                        acc[e] += answers(net, shared, xs[k][e], False)[e] / len(SEEDS)
            for e in M.EVENTS:
                preds[cond][e][test[e]["m"] == k] = acc[e]
        print(json.dumps({"progress": {"minute": k, "s": round(time.time() - started, 1)}}), flush=True)

    out = {"events": {}, "minutes": n, "fine_tune": {"steps": STEPS, "batch": BATCH, "seeds": len(SEEDS), "half_ms": HALF_MS}}
    for e in M.EVENTS:
        T = test[e]
        times = sum(episodes(mins[k]["steps"], e, T["t"][T["m"] == k], T["y"][T["m"] == k]) for k in range(n))
        row = {"windows": int(len(T["y"])), "positive_windows": int((T["y"] > 0.5).sum()), "episodes": times,
               "a_all_windows": T["all"],
               "auc": {"a": M.auc(T["y"], T["a"]), **{c: M.auc(T["y"], preds[c][e]) for c in ("b", "c", "d")}},
               "per_minute": {}}
        for k in range(n):
            s = T["m"] == k
            row["per_minute"][k] = {"windows": int(s.sum()), "positive": int((T["y"][s] > 0.5).sum()),
                                    **{c: (M.auc(T["y"][s], T["a"][s]) if c == "a" else M.auc(T["y"][s], preds[c][e][s])) for c in ("a", "b", "c", "d")}}
        out["events"][e] = row
    out["seconds"] = round(time.time() - started, 1)
    print(json.dumps({"result": out}), flush=True)


if __name__ == "__main__":
    main()
