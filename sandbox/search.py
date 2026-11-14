#!/usr/bin/env python3
"""The search for one person's ear model. It runs inside that person's sandbox, with the network blocked.

    python3 sandbox/search.py <minutes.json> <out.json> [--budget seconds] [--jobs N] [--repo DIR]

`minutes.json` is {"minutes": [...]}: every teaching minute the person has done, oldest first.

What happens, in order:
1. The phone's own code (web/src/tune/ear, run with bun) writes what a model may be taught from: the numbers the
   phone works out for every window length, and the raw motion at 50 a second, with what the camera said next to
   them. Nothing here works those numbers out a second time, so a model found here reads what the phone feeds it.
2. A few hundred candidate models are tried side by side: logistic and linear models, boosted trees and small
   networks on those numbers, and small conv nets on the raw motion. Each one is taught on all the person's
   minutes but one and asked about the whole minute left out, once for every minute (with one minute only: on all
   rounds but one, asked about the round left out).
3. The score that goes on the screen never comes from the candidate that looked best on the same answers. For
   every minute left out, the candidate is chosen on the OTHER left-out minutes only, and its answers on this one
   are the ones that count. So trying many candidates cannot make the number look better than it is.
4. The phone's code scores those answers the way it scores its own models (what luck reaches, how many separate
   times), reads each chosen model back and checks it gets the same answers as here.

stdout is one JSON object per line: {"tried": {name, auc, ms}} as candidates finish, then {"result": {...}}.
"""
from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import argparse
import json
import multiprocessing as mp
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

EVENTS = ["smile", "nod", "shake", "laugh", "talk"]
SUBSETS = ["attitude", "posture", "rotation", "acceleration", "motion", "all"]
# simpler first: at the same score the plainer model is kept
ORDER = {"logistic": 0, "linear": 1, "tree": 2, "network": 3, "conv": 4}


def emit(value: object) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


# ---------------------------------------------------------------- what the phone's code wrote

class Dump:
    def __init__(self, folder: Path):
        self.meta = json.loads((folder / "meta.json").read_text())
        self.sets = {}
        for s in self.meta["sets"]:
            x = np.fromfile(folder / s["file"], dtype=np.float32).reshape(s["n"], s["d"]) if s["n"] else np.zeros((0, s["d"]), np.float32)
            self.sets[(s["kind"], float(s["window"]))] = {
                "x": x,
                "minute": np.asarray(s["minute"], dtype=np.int64),
                "end": np.asarray(s["end"], dtype=np.float64),
                "y": {e: np.asarray(v, dtype=np.float64) for e, v in s["y"].items()},
            }
        self.events = {e: f for e, f in self.meta["events"].items()}
        self.context = float(self.meta["context"])
        self.channels = int(self.meta["channels"])


DUMP: Dump | None = None


def both(y: np.ndarray) -> bool:
    return bool((y > 0.5).any() and ((y >= 0) & (y <= 0.5)).any())


def folds(event: str, s: dict):
    """(block id, taught on, asked about) as index arrays. The same rule as web/src/tune/ear/check.ts."""
    how = DUMP.events[event]
    y = s["y"][event]
    known = y >= 0
    minute = s["minute"]
    end = s["end"]
    if how["kind"] == "minute":
        for k in range(DUMP.meta["minutes"]):
            test = known & (minute == k)
            train = known & (minute != k)
            if test.any() and both(y[train]):
                yield k, np.flatnonzero(train), np.flatnonzero(test)
    else:
        k = how["minute"]
        mine = minute == k
        rest = known & ~mine
        for r, rd in enumerate(how["rounds"]):
            test = known & mine & (end >= rd["t0"]) & (end < rd["until"])
            # everything at least the reader's whole memory away from what will be asked about
            train = known & mine & ((end < rd["t0"] - DUMP.context) | (end - DUMP.context >= rd["until"]))
            if test.any() and both(y[train]):
                yield r, np.flatnonzero(train | rest), np.flatnonzero(test)


def auc(y, p) -> float:
    y = np.asarray(y) > 0.5
    pos = int(y.sum())
    neg = int(len(y) - pos)
    if not pos or not neg:
        return 0.5
    from scipy.stats import rankdata
    r = rankdata(np.asarray(p, dtype=np.float64))
    return float((r[y].sum() - pos * (pos + 1) / 2) / (pos * neg))


def sigmoid(v):
    return 1.0 / (1.0 + np.exp(-np.clip(v, -40, 40)))


def balanced(y: np.ndarray) -> np.ndarray:
    pos = max(1, int((y > 0.5).sum()))
    neg = max(1, int(len(y) - pos))
    return np.where(y > 0.5, len(y) / (2 * pos), len(y) / (2 * neg))


def r6(a) -> list:
    return [float(f"{v:.6g}") for v in np.asarray(a, dtype=np.float64).ravel()]


# ---------------------------------------------------------------- the models
# Every model is kept as the plain description the phone reads (`det`), and answers are always worked out from
# that description, never from the library object: what is scored here is what the phone will run.

def standard(x: np.ndarray):
    mean = x.mean(axis=0)
    scale = np.maximum(1e-5, x.std(axis=0))
    return mean, scale


def zed(det: dict, x: np.ndarray) -> np.ndarray:
    return np.clip((x - np.asarray(det["mean"])) / np.asarray(det["scale"]), -6, 6)


def fit_flat(c: dict, x: np.ndarray, y: np.ndarray) -> dict:
    mean, scale = standard(x)
    det = {"family": c["family"], "window": c["window"], "subset": c["subset"], "mean": r6(mean), "scale": r6(scale), "threshold": 0.5, "on": 0.6, "off": 0.4}
    z = zed(det, x)
    fam = c["family"]
    if fam == "logistic":
        from sklearn.linear_model import LogisticRegression
        m = LogisticRegression(C=1.0 / c["l2"], class_weight="balanced", max_iter=400, tol=1e-5).fit(z, y > 0.5)
        det.update(w=r6(m.coef_[0]), b=float(m.intercept_[0]))
    elif fam == "linear":
        from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
        m = LinearDiscriminantAnalysis(solver="lsqr", shrinkage=c["shrink"], priors=[0.5, 0.5]).fit(z, y > 0.5)
        det.update(w=r6(m.coef_[0]), b=float(m.intercept_[0]))
    elif fam == "tree":
        from sklearn.ensemble import GradientBoostingClassifier
        m = GradientBoostingClassifier(n_estimators=c["trees"], max_depth=c["depth"], learning_rate=c["rate"], min_samples_leaf=8, subsample=0.8, random_state=0)
        m.fit(z.astype(np.float32), y > 0.5, sample_weight=balanced(y))
        nodes = []
        roots = []
        for est in m.estimators_[:, 0]:
            t = est.tree_
            base = len(nodes)
            roots.append(base)
            for i in range(t.node_count):
                leaf = t.children_left[i] < 0
                nodes.append({
                    "feature": -1 if leaf else int(t.feature[i]),
                    "threshold": 0.0 if leaf else float(t.threshold[i]),
                    "left": -1 if leaf else base + int(t.children_left[i]),
                    "right": -1 if leaf else base + int(t.children_right[i]),
                    "value": float(f"{t.value[i, 0, 0]:.6g}"),
                })
        det.update(trees=nodes, treeRoots=roots, treeCount=len(roots), treeDepth=c["depth"], shrinkage=c["rate"], b=0.0)
        # what the ensemble starts from, read off one row so no library internals are assumed
        row = z[:1].astype(np.float32)
        det["b"] = float(m.decision_function(row)[0] - c["rate"] * sum(est.predict(row)[0] for est in m.estimators_[:, 0]))
    elif fam == "network":
        import torch
        torch.manual_seed(c.get("seed", 0))
        h = c["hidden"]
        zt = torch.tensor(z, dtype=torch.float32)
        yt = torch.tensor(y > 0.5, dtype=torch.float32)
        wt = torch.tensor(balanced(y), dtype=torch.float32)
        l1 = torch.nn.Linear(z.shape[1], h)
        l2 = torch.nn.Linear(h, 1)
        opt = torch.optim.Adam([*l1.parameters(), *l2.parameters()], lr=0.02, weight_decay=c["decay"])
        for _ in range(160):
            opt.zero_grad()
            out = l2(torch.tanh(l1(zt))).squeeze(1)
            torch.nn.functional.binary_cross_entropy_with_logits(out, yt, weight=wt).backward()
            opt.step()
        det.update(hidden=h, w1=r6(l1.weight.detach().numpy()), b1=r6(l1.bias.detach().numpy()), w2=r6(l2.weight.detach().numpy()[0]), b2=float(l2.bias.detach().numpy()[0]))
    else:
        raise ValueError(fam)
    return det


def fit_conv(c: dict, x: np.ndarray, ys: dict[str, np.ndarray]) -> dict[str, dict]:
    """One small conv net over the raw motion, with one answer per thing. `x` is windows by (time*channels)."""
    import torch
    torch.manual_seed(c.get("seed", 0))
    ch = DUMP.channels
    n = x.shape[0]
    length = x.shape[1] // ch
    cube = x.reshape(n, length, ch)
    mean = cube.reshape(-1, ch).mean(axis=0)
    scale = np.maximum(1e-4, cube.reshape(-1, ch).std(axis=0))
    z = np.clip((cube - mean) / scale, -8, 8).transpose(0, 2, 1)   # windows, channels, time
    names = list(ys)
    target = np.stack([np.where(ys[e] > 0.5, 1.0, 0.0) for e in names], axis=1)
    weight = np.zeros((n, len(names)))
    for j, e in enumerate(names):
        k = ys[e] >= 0
        w = np.zeros(n)
        w[k] = balanced(ys[e][k])
        weight[:, j] = w
    convs = []
    cin = ch
    for (cout, k, s) in c["layers"]:
        convs.append(torch.nn.Conv1d(cin, cout, k, stride=s))
        cin = cout
    head = torch.nn.Linear(2 * cin, len(names))
    params = [p for m in [*convs, head] for p in m.parameters()]
    opt = torch.optim.Adam(params, lr=3e-3, weight_decay=1e-4)
    zt = torch.tensor(z, dtype=torch.float32)
    tt = torch.tensor(target, dtype=torch.float32)
    wt = torch.tensor(weight, dtype=torch.float32)

    def forward(v):
        for m in convs:
            v = torch.relu(m(v))
        return head(torch.cat([v.mean(dim=2), v.amax(dim=2)], dim=1))

    gen = torch.Generator().manual_seed(c.get("seed", 0))
    batch = 96
    # the same number of steps however many minutes there are, so more minutes do not make it slower
    for _ in range(max(4, min(24, round(c["steps"] * batch / max(1, n))))):
        order = torch.randperm(n, generator=gen)
        for i in range(0, n, batch):
            idx = order[i:i + batch]
            v = zt[idx]
            # a little noise and a little change of size, so it does not learn one minute's exact shapes
            v = v * (1 + 0.1 * (torch.rand(len(idx), 1, 1, generator=gen) - 0.5) * 2) + 0.05 * torch.randn(v.shape, generator=gen)
            opt.zero_grad()
            torch.nn.functional.binary_cross_entropy_with_logits(forward(v), tt[idx], weight=wt[idx]).backward()
            opt.step()
    layers = [{"k": m.kernel_size[0], "s": m.stride[0], "cin": m.in_channels, "cout": m.out_channels, "w": r6(m.weight.detach().numpy()), "b": r6(m.bias.detach().numpy())} for m in convs]
    out = {}
    for j, e in enumerate(names):
        out[e] = {"family": "conv", "window": c["window"], "subset": "raw", "mean": r6(mean), "scale": r6(scale), "layers": layers,
                  "w": r6(head.weight.detach().numpy()[j]), "b": float(head.bias.detach().numpy()[j]), "threshold": 0.5, "on": 0.6, "off": 0.4}
    return out


def predict(det: dict, x: np.ndarray) -> np.ndarray:
    """The phone's own arithmetic (predictDet in web/src/tune/ear/check.ts), on many rows at once."""
    fam = det["family"]
    if fam == "conv":
        ch = len(det["mean"])
        n = x.shape[0]
        cur = np.clip((x.reshape(n, -1, ch) - np.asarray(det["mean"])) / np.asarray(det["scale"]), -8, 8)   # windows, time, channels
        for layer in det["layers"]:
            k, s, cin, cout = layer["k"], layer["s"], layer["cin"], layer["cout"]
            w = np.asarray(layer["w"]).reshape(cout, cin, k)
            steps = (cur.shape[1] - k) // s + 1
            nxt = np.zeros((n, steps, cout))
            for j in range(k):
                nxt += cur[:, j:j + (steps - 1) * s + 1:s, :] @ w[:, :, j].T
            cur = np.maximum(0, nxt + np.asarray(layer["b"]))
        pooled = np.concatenate([cur.mean(axis=1), cur.max(axis=1)], axis=1)
        return sigmoid(pooled @ np.asarray(det["w"]) + det["b"])
    z = zed(det, x)
    if fam == "network":
        h = det["hidden"]
        w1 = np.asarray(det["w1"]).reshape(h, -1)
        return sigmoid(np.tanh(z @ w1.T + np.asarray(det["b1"])) @ np.asarray(det["w2"]) + det["b2"])
    if fam == "tree":
        nodes = det["trees"]
        feature = np.array([nd["feature"] for nd in nodes])
        threshold = np.array([nd["threshold"] for nd in nodes])
        left = np.array([nd["left"] for nd in nodes])
        right = np.array([nd["right"] for nd in nodes])
        value = np.array([nd["value"] for nd in nodes])
        total = np.zeros(z.shape[0])
        rows = np.arange(z.shape[0])
        for root in det["treeRoots"]:
            at = np.full(z.shape[0], root)
            while True:
                inner = feature[at] >= 0
                if not inner.any():
                    break
                go = z[rows[inner], feature[at[inner]]] <= threshold[at[inner]]
                at[inner] = np.where(go, left[at[inner]], right[at[inner]])
            total += value[at]
        return sigmoid(det["b"] + det["shrinkage"] * total)
    return sigmoid(z @ np.asarray(det["w"]) + det["b"])


# ---------------------------------------------------------------- the candidates

def candidates() -> list[dict]:
    out: list[dict] = []
    convs = [
        (1.0, [(16, 7, 2), (32, 5, 2)]),
        (2.0, [(16, 7, 2), (32, 5, 2)]),
        (2.0, [(24, 9, 2), (48, 5, 2), (48, 3, 1)]),
        (3.5, [(16, 7, 2), (32, 5, 2)]),
        (3.5, [(24, 9, 2), (48, 5, 2), (48, 3, 2)]),
        (3.5, [(16, 15, 4), (32, 5, 2)]),
    ]
    for seconds, layers in convs:
        shape = "-".join(str(l[0]) for l in layers)
        out.append({"family": "conv", "window": seconds, "subset": "raw", "layers": layers, "steps": 320,
                    "name": f"conv net on the raw motion, {seconds:g} s, {shape} wide, first looks at {layers[0][1] * 20} ms"})
    rest: list[list[dict]] = []
    for window in [0.4, 0.6, 1.0, 1.5, 2.0]:
        for subset in SUBSETS:
            group: list[dict] = []
            what = "all the numbers" if subset == "all" else subset
            base = {"window": window, "subset": subset}
            for l2 in [0.3, 1, 3, 10, 30]:
                group.append({**base, "family": "logistic", "l2": l2, "name": f"logistic, {window:g} s, {what}, pull {l2:g}"})
            for shrink in ["auto", 0.5]:
                group.append({**base, "family": "linear", "shrink": shrink, "name": f"linear, {window:g} s, {what}, shrink {shrink}"})
            for depth, trees in [(1, 60), (2, 40), (3, 30)]:
                group.append({**base, "family": "tree", "depth": depth, "trees": trees, "rate": 0.15, "name": f"boosted trees, {window:g} s, {what}, {trees} trees {depth} deep"})
            for hidden in [8, 16]:
                group.append({**base, "family": "network", "hidden": hidden, "decay": 1e-3, "name": f"small network, {window:g} s, {what}, {hidden} hidden"})
            rest.append(group)
    # one of each kind at a time, so the board is not all one family while it fills
    for i in range(max(len(g) for g in rest)):
        for g in rest:
            if i < len(g):
                out.append(g[i])
    return out


def conv_groups() -> list[list[str]]:
    """Things checked the same way share one conv net; a thing checked another way gets its own."""
    groups: dict[str, list[str]] = {}
    for e in DUMP.events:
        groups.setdefault(json.dumps(DUMP.events[e], sort_keys=True), []).append(e)
    return list(groups.values())


def conv_blocks(c: dict) -> list[tuple[int, int]]:
    """(group, block) for every block a conv candidate is asked about: each is its own task."""
    s = DUMP.sets[("raw", float(c["window"]))]
    out = []
    for g, names in enumerate(conv_groups()):
        for b in sorted({b for e in names for b, _, _ in folds(e, s)}):
            out.append((g, b))
    return out


def run(task: tuple[int, tuple[int, int] | None]) -> dict:
    """One candidate asked about blocks it never saw (a conv net: one block at a time). Runs in a worker process."""
    index, part = task
    c = CANDS[index]
    t0 = time.time()
    got: dict[str, dict] = {}
    try:
        if c["family"] == "conv":
            s = DUMP.sets[("raw", float(c["window"]))]
            g, b = part
            names = conv_groups()[g]
            plans = {e: {bb: (tr, te) for bb, tr, te in folds(e, s)} for e in names}
            live = [e for e in names if b in plans[e]]
            train = np.unique(np.concatenate([plans[e][b][0] for e in live]))
            ys = {}
            for e in live:
                y = np.full(len(train), -1.0)
                y[np.searchsorted(train, plans[e][b][0])] = s["y"][e][plans[e][b][0]]
                ys[e] = y
            dets = fit_conv(c, s["x"][train], ys)
            for e in live:
                test = plans[e][b][1]
                got.setdefault(e, {})[b] = (test, predict(dets[e], s["x"][test]))
        else:
            s = DUMP.sets[("features", float(c["window"]))]
            cols = DUMP.meta["subsets"][c["subset"]]
            x = s["x"][:, cols]
            for e in DUMP.events:
                y = s["y"][e]
                for b, train, test in folds(e, s):
                    det = fit_flat(c, x[train], y[train])
                    got.setdefault(e, {})[b] = (test, predict(det, x[test]))
    except Exception as exc:   # one bad candidate must not end the search
        return {"i": index, "error": f"{type(exc).__name__}: {str(exc)[:200]}", "ms": int((time.time() - t0) * 1000), "got": {}}
    return {"i": index, "ms": int((time.time() - t0) * 1000), "got": got}


CANDS: list[dict] = []


def final_det(c: dict, event: str, cache: dict) -> dict:
    """The chosen candidate, taught on everything the teacher could say about."""
    if c["family"] == "conv":
        key = (c["name"], json.dumps(DUMP.events[event], sort_keys=True))
        if key not in cache:
            s = DUMP.sets[("raw", float(c["window"]))]
            names = [e for e in DUMP.events if json.dumps(DUMP.events[e], sort_keys=True) == key[1]]
            keep = np.flatnonzero(np.any([s["y"][e] >= 0 for e in names], axis=0))
            cache[key] = fit_conv(c, s["x"][keep], {e: s["y"][e][keep] for e in names})
        return cache[key][event]
    s = DUMP.sets[("features", float(c["window"]))]
    y = s["y"][event]
    keep = np.flatnonzero(y >= 0)
    return fit_flat(c, s["x"][keep][:, DUMP.meta["subsets"][c["subset"]]], y[keep])


def set_of(c: dict) -> dict:
    return DUMP.sets[("raw" if c["family"] == "conv" else "features", float(c["window"]))]


def rows_of(c: dict, s: dict) -> np.ndarray:
    return s["x"] if c["family"] == "conv" else s["x"][:, DUMP.meta["subsets"][c["subset"]]]


def main() -> int:
    global DUMP, CANDS
    ap = argparse.ArgumentParser()
    ap.add_argument("minutes")
    ap.add_argument("out")
    ap.add_argument("--budget", type=float, default=40.0)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--only", default="", help="one family only: for the tests that read each kind of model back")
    args = ap.parse_args()
    started = time.time()
    cli = str(Path(args.repo) / "web/src/tune/ear/cli.ts")

    with tempfile.TemporaryDirectory(prefix="vire-search-") as td:
        work = Path(td)
        (work / "dump").mkdir()
        # what each minute added is worked out next to the search, by the phone's own code
        curve = subprocess.Popen(["bun", cli, "curve", args.minutes, str(work / "curve.json")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        made = subprocess.run(["bun", cli, "dump", args.minutes, str(work / "dump")], capture_output=True, text=True)
        if made.returncode != 0:
            emit({"error": f"could not read the minutes: {made.stderr.strip()[:300]}"})
            return 1
        DUMP = Dump(work / "dump")
        if not DUMP.events:
            emit({"error": "the camera did not see enough in these minutes to check a model on"})
            return 1
        CANDS = [c for c in candidates() if not args.only or c["family"] == args.only]
        emit({"note": {"minutes": DUMP.meta["minutes"], "candidates": len(CANDS), "jobs": args.jobs, "events": DUMP.events and list(DUMP.events)}})

        results: dict[int, dict] = {}
        board: list[dict] = []
        deadline = started + args.budget
        tasks: list[tuple[int, tuple[int, int] | None]] = []
        parts: dict[int, int] = {}
        for i, c in enumerate(CANDS):
            if c["family"] == "conv":
                blocks_ = conv_blocks(c)
                parts[i] = len(blocks_)
                tasks += [(i, part) for part in blocks_]
            else:
                tasks.append((i, None))
        partial: dict[int, dict] = {}
        pool = mp.get_context("fork").Pool(args.jobs)
        try:
            it = pool.imap_unordered(run, tasks)
            for _ in tasks:
                left = deadline - time.time()
                if left <= 0:
                    break
                try:
                    res = it.next(timeout=left)
                except (mp.TimeoutError, StopIteration):
                    break
                i = res["i"]
                if i in parts:
                    # a conv net is whole when every block it is asked about has come back
                    whole = partial.setdefault(i, {"i": i, "ms": 0, "got": {}, "n": 0, "bad": False})
                    whole["n"] += 1
                    whole["ms"] += res["ms"]
                    whole["bad"] = whole["bad"] or not res["got"]
                    for e, blocks in res["got"].items():
                        whole["got"].setdefault(e, {}).update(blocks)
                    if whole["n"] < parts[i] or whole["bad"]:
                        continue
                    res = whole
                if not res["got"]:
                    continue
                results[i] = res
                # the board shows what this candidate got on what it never saw, averaged over the things taught
                s = set_of(CANDS[i])
                per = []
                for e, blocks in res["got"].items():
                    y = np.concatenate([s["y"][e][te] for te, _ in blocks.values()])
                    p = np.concatenate([pp for _, pp in blocks.values()])
                    per.append(auc(y, p))
                row = {"name": CANDS[i]["name"], "auc": round(float(np.mean(per)), 4), "ms": res["ms"]}
                board.append(row)
                emit({"tried": row})
        finally:
            pool.terminate()
            pool.join()
        if not results:
            emit({"error": "no candidate finished in time"})
            return 1

        picked = {"tried": len(results), "board": sorted(board, key=lambda r: (-r["auc"], r["ms"], r["name"])), "events": {}}
        cache: dict = {}
        for e, how in DUMP.events.items():
            have = {i: r["got"][e] for i, r in results.items() if e in r["got"]}
            if not have:
                continue
            blocks = sorted({b for g in have.values() for b in g})

            def pooled(i: int, leave: int | None) -> float:
                s = set_of(CANDS[i])
                ys = [s["y"][e][te] for b, (te, _) in have[i].items() if b != leave]
                ps = [pp for b, (_, pp) in have[i].items() if b != leave]
                if not ys:
                    return -1.0
                y = np.concatenate(ys)
                return auc(y, np.concatenate(ps)) if both(y) else -1.0

            def best(leave: int | None, need: int | None) -> int | None:
                pool_ = [i for i in have if need is None or need in have[i]]
                if not pool_:
                    return None
                return max(pool_, key=lambda i: (round(pooled(i, leave), 3), -ORDER[CANDS[i]["family"]], -i))

            def answers(parts: list[tuple[int, int]]) -> dict:
                out = {"m": [], "t": [], "y": [], "p": []}
                for i, b in parts:
                    s = set_of(CANDS[i])
                    te, pp = have[i][b]
                    out["m"] += s["minute"][te].tolist()
                    out["t"] += s["end"][te].tolist()
                    out["y"] += s["y"][e][te].tolist()
                    out["p"] += [float(f"{v:.5g}") for v in pp]
                return out

            # for each block left out, the candidate that did best on the OTHER blocks answers for this one
            parts = []
            for b in blocks:
                i = best(b, b)
                if i is not None and pooled(i, b) >= 0:
                    parts.append((i, b))
            top = best(None, None)
            if top is None or not parts:
                continue
            c = CANDS[top]
            det = final_det(c, e, cache)
            det["name"] = c["name"]
            s = set_of(c)
            n = s["x"].shape[0]
            sample = np.unique(np.linspace(0, n - 1, min(n, 160)).astype(int))
            # the window's place inside its own minute, which is how the phone's code finds it again
            first = {k: int(np.flatnonzero(s["minute"] == k)[0]) for k in np.unique(s["minute"])}
            picked["events"][e] = {
                "kind": how["kind"],
                "det": det,
                "held": answers(parts),
                "own": answers([(top, b) for b in have[top]]),
                "check": {"m": s["minute"][sample].tolist(), "i": [int(j - first[int(s["minute"][j])]) for j in sample], "p": [float(v) for v in predict(det, rows_of(c, s)[sample])]},
                "chosen": [CANDS[i]["name"] for i, _ in parts],
            }
        (work / "picked.json").write_text(json.dumps(picked))
        try:
            curve.wait(timeout=max(1.0, min(30.0, started + args.budget + 30 - time.time())))
        except subprocess.TimeoutExpired:
            curve.kill()
        done = subprocess.run(["bun", cli, "finish", args.minutes, str(work / "picked.json"), args.out, "--curve", str(work / "curve.json")], capture_output=True, text=True)
        if done.returncode != 0:
            emit({"error": f"could not finish: {done.stderr.strip()[:300]}"})
            return 1
        result = json.loads(Path(args.out).read_text())
        result["seconds"] = round(time.time() - started, 1)
        result["chosen"] = {e: v["chosen"] for e, v in picked["events"].items()}
        Path(args.out).write_text(json.dumps(result))
        emit({"result": result})
    return 0


if __name__ == "__main__":
    sys.exit(main())
