"""Shared-model pretraining on EarSet (Zenodo 8142332, CC BY 4.0), on Modal.

    modal run sandbox/shared_model/modal_pretrain.py::prep                      # CPU: read, calibrate, window
    modal run sandbox/shared_model/modal_pretrain.py::train --epochs 6 --tag e6  # GPU: train, checkpoint each epoch
    modal run sandbox/shared_model/modal_pretrain.py::fetch --tag e6             # read back weights and progress

The public archive is downloaded and read only inside Modal, on the Volume `vire-shared-model-data`. `prep` writes
the windows and the calibration to the Volume; `train` writes a checkpoint and a small progress file there after
every epoch, so a timeout still leaves usable weights. Nothing from the archive comes back to the box except
counts, calibration numbers and the trained weights.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

app = modal.App("vire-shared-model-pretrain")
DATA = modal.Volume.from_name("vire-shared-model-data", create_if_missing=True)
IMAGE = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("numpy", "torch")
    .add_local_file(str(HERE / "model.py"), remote_path="/root/model.py")
    .add_local_file(str(HERE / "earset.py"), remote_path="/root/earset.py")
)
URL = "https://zenodo.org/api/records/8142332/files/EarSet_v1.zip/content"
ARCHIVE = "/data/EarSet_v1.zip"
PREP = "/data/prep-v2"
VAL_PARTICIPANTS = 5  # the highest-numbered participants are held out to check the shared model on EarSet itself


def _convert(job):
    import numpy as np
    import zipfile
    import earset
    name, pid, act, side, cal = job
    with zipfile.ZipFile(ARCHIVE) as z:
        rows = earset.read(z.read(name))
    if rows is None:
        return None
    six = earset.convert(rows, side, cal)
    w = earset.windows(six)
    stats = {"seconds": float((rows[-1, 0] - rows[0, 0]) / 1000), "rate": float(1000 / np.median(np.diff(rows[:, 0])))}
    return pid, act, side, w.astype(np.float16), stats


@app.function(image=IMAGE, cpu=16, memory=32768, timeout=1500, volumes={"/data": DATA})
def prep() -> str:
    import multiprocessing as mp
    import urllib.request
    import zipfile

    import numpy as np
    import earset

    t0 = time.time()
    arc = Path(ARCHIVE)
    if not arc.exists() or arc.stat().st_size < 100_000_000:
        tmp = arc.with_suffix(".download")
        urllib.request.urlretrieve(URL, tmp)
        tmp.replace(arc)
        DATA.commit()
    with zipfile.ZipFile(arc) as z:
        ents = earset.entries(z.namelist())
        print(f"{len(ents)} earbud IMU files", flush=True)
        # calibration on the still, nod, tilt and shake files of every participant
        files = {}
        for name, pid, act, side in ents:
            if act in ("still", "nod", "tilt", "shake"):
                rows = earset.read(z.read(name))
                if rows is not None:
                    files[(pid, act, side)] = rows
    cal = earset.calibrate(files)
    print("calibration", json.dumps(cal), flush=True)
    del files

    jobs = [(name, pid, act, side, cal) for name, pid, act, side in ents]
    xs, cls, pids, sides = [], [], [], []
    seconds = {}
    rates = []
    with mp.get_context("fork").Pool(16) as pool:
        for k, res in enumerate(pool.imap_unordered(_convert, jobs, chunksize=4)):
            if res is None:
                continue
            pid, act, side, w, st = res
            seconds[act] = seconds.get(act, 0.0) + st["seconds"]
            rates.append(st["rate"])
            if len(w):
                xs.append(w); cls += [act] * len(w); pids += [pid] * len(w); sides += [side] * len(w)
            if k % 200 == 0:
                print(f"converted {k}/{len(jobs)} in {time.time() - t0:.0f}s", flush=True)
    classes = sorted(set(cls))
    x = np.concatenate(xs)
    y = np.asarray([classes.index(c) for c in cls], np.int16)
    p = np.asarray(pids, np.int16)
    out = Path(PREP); out.mkdir(parents=True, exist_ok=True)
    np.save(out / "x.npy", x); np.save(out / "y.npy", y); np.save(out / "p.npy", p)
    # what the units look like per activity, to check the calibration against the AirPods (aggregates only)
    rms = {}
    for c in ("still", "nod", "shake", "lip-puller", "speaking"):
        if c in classes:
            sel = x[y == classes.index(c)].astype(np.float32)
            rms[c] = np.sqrt((sel ** 2).mean(axis=(0, 1))).round(3).tolist()
    meta = {
        "classes": classes, "windows": int(len(x)), "participants": sorted(set(int(v) for v in p)),
        "per_class_windows": {c: int((y == i).sum()) for i, c in enumerate(classes)},
        "hours": round(sum(seconds.values()) / 3600, 2), "per_class_seconds": {k: round(v) for k, v in seconds.items()},
        "median_rate_hz": float(np.median(rates)), "calibration": cal, "rms_per_class": rms,
        "window_s": 2.0, "stride_s": 0.5, "prep_s": round(time.time() - t0, 1),
    }
    (out / "meta.json").write_text(json.dumps(meta))
    DATA.commit()
    return json.dumps(meta)


@app.function(image=IMAGE, gpu="T4", cpu=4, memory=16384, timeout=1800, volumes={"/data": DATA})
def train(epochs: int = 6, tag: str = "run", lr: float = 2e-3, batch: int = 256, seed: int = 17) -> str:
    import numpy as np
    import torch

    import model as M

    t0 = time.time()
    DATA.reload()
    meta = json.loads(Path(PREP, "meta.json").read_text())
    x = np.load(Path(PREP, "x.npy")).astype(np.float32)
    y = np.load(Path(PREP, "y.npy")).astype(np.int64)
    p = np.load(Path(PREP, "p.npy")).astype(np.int64)
    # the archive's calibration and sync recordings are not activities; numbered repeats join their activity
    raw_classes = meta["classes"]
    def clean(c: str) -> str | None:
        if "calib" in c or "sync" in c:
            return None
        base = c.rsplit("-", 1)[0] if c[-2:] in ("-1", "-2") else c
        return base if base in raw_classes else c
    classes = sorted({clean(c) for c in raw_classes} - {None})
    remap = np.asarray([classes.index(clean(c)) if clean(c) else -1 for c in raw_classes])
    y = remap[y]
    ok = y >= 0
    x, y, p = x[ok], y[ok], p[ok]
    parts = sorted(set(p.tolist()))
    val_p = set(parts[-VAL_PARTICIPANTS:])
    tr = ~np.isin(p, list(val_p)); va = ~tr
    mean = x[tr].reshape(-1, M.CHANNELS).mean(0)
    scale = np.maximum(1e-4, x[tr].reshape(-1, M.CHANNELS).std(0))
    z = torch.tensor(M.normalize(x, mean, scale))
    yt = torch.tensor(y)
    dev = "cuda"
    ztr, ytr = z[tr].to(dev), yt[tr].to(dev)
    zva, yva = z[va].to(dev), yt[va]
    # balanced classes: every class drawn equally often
    counts = np.bincount(y[tr], minlength=len(classes)).astype(np.float64)
    wsample = torch.tensor(1.0 / counts[y[tr]], dtype=torch.double)
    torch.manual_seed(seed)
    gen = torch.Generator().manual_seed(seed)
    net = M.make_net(len(classes)).to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=1e-3)
    steps_per_epoch = int(tr.sum()) // batch
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * steps_per_epoch)
    ck = Path("/data/ckpt") / tag; ck.mkdir(parents=True, exist_ok=True)
    progress = []
    base = {"version": 2, "dataset": "EarSet (Zenodo 8142332, CC BY 4.0)", "classes": classes, "width": [32, 64],
            "mean": mean.tolist(), "scale": scale.tolist(), "hz": M.HZ, "seconds": M.SECONDS,
            "val_participants": sorted(val_p), "gpu": "T4"}
    for ep in range(epochs):
        net.train()
        idx = torch.multinomial(wsample, steps_per_epoch * batch, replacement=True, generator=gen).to(dev)
        tot = 0.0
        for s in range(steps_per_epoch):
            j = idx[s * batch:(s + 1) * batch]
            xb = M.augment(ztr[j], gen, flips=True, rotate_deg=25)
            loss = torch.nn.functional.cross_entropy(net(xb), ytr[j])
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            tot += float(loss)
        net.eval()
        with torch.no_grad():
            pr = torch.cat([torch.softmax(net(zva[i:i + 4096]), 1).cpu() for i in range(0, len(zva), 4096)]).numpy()
        acc = float((pr.argmax(1) == yva.numpy()).mean())
        per_class = {c: float((pr.argmax(1)[yva.numpy() == i] == i).mean()) for i, c in enumerate(classes) if (yva.numpy() == i).any()}
        aucs = {c: M.auc(yva.numpy() == classes.index(c), pr[:, classes.index(c)]) for c in ("nod", "shake", "lip-puller") if c in classes}
        row = {"epoch": ep + 1, "loss": round(tot / steps_per_epoch, 4), "val_acc": round(acc, 4),
               "val_balanced_acc": round(float(np.mean(list(per_class.values()))), 4),
               "val_auc_one_vs_rest": {k: round(v, 4) for k, v in aucs.items()}, "s": round(time.time() - t0, 1)}
        progress.append(row)
        print(json.dumps(row), flush=True)
        blob = M.save_state(net, {**base, "epochs": ep + 1, "progress": progress})
        (ck / "latest.json").write_text(json.dumps(blob))
        (ck / "progress.json").write_text(json.dumps(progress))
        DATA.commit()
    return json.dumps({"tag": tag, "epochs": epochs, "progress": progress, "wall_s": round(time.time() - t0, 1)})


@app.function(image=IMAGE, timeout=300, volumes={"/data": DATA})
def fetch(tag: str = "run") -> str:
    DATA.reload()
    return Path("/data/ckpt", tag, "latest.json").read_text()


@app.local_entrypoint()
def main(step: str = "prep", epochs: int = 6, tag: str = "run", out: str = ""):
    if step == "prep":
        res = prep.remote()
    elif step == "train":
        res = train.remote(epochs=epochs, tag=tag)
    else:
        res = fetch.remote(tag=tag)
    if out:
        Path(out).write_text(res)
        print("wrote", out, len(res))
    else:
        print(res[:4000])
