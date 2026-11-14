"""The shared six-axis model and the arithmetic both sides use (Modal pretraining and the per-person sandbox).

Six channels in the AirPods' frame and units: ax, ay, az (user acceleration, g, gravity out) and rx, ry, rz
(rotation rate, degrees a second), x = the nod axis, z = the head-shake axis. 2 s windows at 50 a second.
The net is the protocol's small two-layer 1-D conv net (with mean and max pooling over time).
"""
from __future__ import annotations

import json

import numpy as np

HZ = 50
SECONDS = 2.0
LEN = int(SECONDS * HZ)
CHANNELS = 6
EVENTS = ("smile", "nod", "shake")
# which EarSet activity stands for each Vire event when the model is used without any teaching (condition c):
# lip corner puller is the smile muscle (action unit 12)
EARSET_FOR = {"smile": "lip-puller", "nod": "nod", "shake": "shake"}


def make_net(n_out: int, width: tuple[int, int] = (32, 64), dropout: float = 0.2):
    import torch
    import torch.nn as nn

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.c1 = nn.Conv1d(CHANNELS, width[0], 7, stride=2)
            self.c2 = nn.Conv1d(width[0], width[1], 5, stride=2)
            self.drop = nn.Dropout(dropout)
            self.head = nn.Linear(2 * width[1], n_out)

        def features(self, x):  # x: (n, channels, time)
            h = torch.relu(self.c1(x))
            h = torch.relu(self.c2(h))
            return torch.cat([h.mean(dim=2), h.amax(dim=2)], dim=1)

        def forward(self, x):
            return self.head(self.drop(self.features(x)))

    return Net()


def normalize(x: np.ndarray, mean, scale) -> np.ndarray:
    """(n, time, channels) -> (n, channels, time), standardized with the pretraining set's numbers and clipped."""
    z = (x - np.asarray(mean, np.float32)) / np.asarray(scale, np.float32)
    return np.clip(z, -8, 8).transpose(0, 2, 1).astype(np.float32)


def augment(xb, generator, flips: bool, rotate_deg: float):
    """Random rotation of both triplets, optional sign flips per axis, size change and noise (torch, on any device)."""
    import torch
    n = xb.shape[0]
    dev = xb.device
    if rotate_deg > 0:
        ang = (torch.rand(n, 3, generator=generator).to(dev) * 2 - 1) * np.deg2rad(rotate_deg)
        cx, cy, cz = torch.cos(ang).T
        sx, sy, sz = torch.sin(ang).T
        one, zero = torch.ones(n, device=dev), torch.zeros(n, device=dev)
        rx = torch.stack([one, zero, zero, zero, cx, -sx, zero, sx, cx], 1).view(n, 3, 3)
        ry = torch.stack([cy, zero, sy, zero, one, zero, -sy, zero, cy], 1).view(n, 3, 3)
        rz = torch.stack([cz, -sz, zero, sz, cz, zero, zero, zero, one], 1).view(n, 3, 3)
        r = rz @ ry @ rx
        xb = torch.cat([r @ xb[:, :3], r @ xb[:, 3:]], dim=1)
    if flips:
        s = (torch.randint(0, 2, (n, 3, 1), generator=generator).to(dev) * 2 - 1).float()
        xb = torch.cat([xb[:, :3] * s, xb[:, 3:] * s], dim=1)
    scale = 1 + (torch.rand(n, 1, 1, generator=generator).to(dev) * 2 - 1) * 0.2
    return xb * scale + 0.05 * torch.randn(xb.shape, generator=generator).to(dev)


def save_state(net, meta: dict) -> dict:
    return {**meta, "state": {k: v.detach().cpu().numpy().tolist() for k, v in net.state_dict().items()}}


def load_state(blob: dict):
    import torch
    net = make_net(len(blob["classes"]), tuple(blob.get("width", (32, 64))))
    net.load_state_dict({k: torch.tensor(np.asarray(v, np.float32)) for k, v in blob["state"].items()})
    return net


# ---------------------------------------------------------------- Vire recordings

def vire_six(rec: dict) -> tuple[np.ndarray, np.ndarray]:
    """(times ms, (n, 6) rows) from a Vire recording's head rows: [t, pitch, yaw, roll, ax, ay, az, rx, ry, rz]."""
    rows = [r for r in rec.get("head", []) if len(r) >= 10]
    a = np.asarray([[r[0], r[4], r[5], r[6], r[7], r[8], r[9]] for r in rows], np.float64)
    if not len(a):
        return np.zeros(0), np.zeros((0, 6))
    a = a[np.argsort(a[:, 0], kind="mergesort")]
    return a[:, 0], np.nan_to_num(a[:, 1:])


def vire_windows(ts: np.ndarray, six: np.ndarray, ends: np.ndarray) -> np.ndarray:
    """2 s windows on a 50-a-second grid ending at each time in `ends` (all must have 2 s of history)."""
    out = np.empty((len(ends), LEN, CHANNELS), np.float32)
    for i, t in enumerate(ends):
        grid = t - (LEN - 1 - np.arange(LEN)) * (1000.0 / HZ)
        out[i] = np.stack([np.interp(grid, ts, six[:, c]) for c in range(CHANNELS)], axis=1)
    return out


def auc(y, p) -> float:
    y = np.asarray(y) > 0.5
    p = np.asarray(p, np.float64)
    pos = int(y.sum()); neg = len(y) - pos
    if not pos or not neg:
        return float("nan")
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(len(p)); i = 0
    while i < len(p):
        j = i
        while j + 1 < len(p) and p[order[j + 1]] == p[order[i]]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return float((ranks[y].sum() - pos * (pos + 1) / 2) / (pos * neg))


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))
