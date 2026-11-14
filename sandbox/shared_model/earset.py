"""Read EarSet (Zenodo 8142332, CC BY 4.0) and put it in the AirPods' frame and units.

Runs only inside Modal, next to the archive on the Modal Volume. Nothing from the archive is written to the box.

EarSet's earbud IMU files are `Dataset/P<id>/EARBUDS/<id>-<activity>-imu-<left|right>.csv` with the header
`timestamp,ax,ay,az,gx,gy,gz`: Unix milliseconds and raw sensor counts at about 100 a second. Vire's AirPods rows
carry user acceleration in g (gravity already taken out by the phone) and rotation rate in degrees a second, with
x = the nod axis (pitch), z = the head-shake axis (yaw), y = roll. So for every EarSet file this module
1. turns counts into g and degrees a second (scales measured from the archive itself, see `calibrate`),
2. takes gravity out with a simple complementary filter, as the phone does for the AirPods,
3. renames the axes so the nod axis is x and the shake axis is z, per ear side (the left and right buds are
   mounted mirrored); which axis is which is read off the archive's own nod and shake files,
4. lays the motion on an even 50-a-second grid.
Signs are not matched: the training flips axis signs at random, so the model does not depend on them.
"""
from __future__ import annotations

import io
import re

import numpy as np

HZ = 50
NAME = re.compile(r"^Dataset/P(\d+)/EARBUDS/\d+-(.+)-imu-(left|right)\.csv$")
STANDARD_DPS = (131.0, 65.5, 32.8, 16.4)       # counts per degree a second of the usual gyro ranges
STANDARD_G = (16384.0, 8192.0, 4096.0, 2048.0)  # counts per g of the usual accelerometer ranges


def entries(names: list[str]) -> list[tuple[str, int, str, str]]:
    out = []
    for n in names:
        m = NAME.match(n)
        if m:
            out.append((n, int(m.group(1)), m.group(2).lower(), m.group(3)))
    return out


def read(raw: bytes) -> np.ndarray | None:
    """(n, 7): time in ms, three accelerometer counts, three gyro counts; sorted, repeated times dropped."""
    try:
        a = np.loadtxt(io.BytesIO(raw), delimiter=",", skiprows=1, dtype=np.float64, ndmin=2)
    except Exception:
        return None
    if a.shape[0] < 200 or a.shape[1] < 7:
        return None
    a = a[:, :7]
    a = a[np.all(np.isfinite(a), axis=1)]
    a = a[np.argsort(a[:, 0], kind="mergesort")]
    keep = np.concatenate([[True], np.diff(a[:, 0]) > 0])
    a = a[keep]
    return a if len(a) >= 200 else None


def nearest(x: float, options: tuple[float, ...]) -> float:
    return min(options, key=lambda o: abs(np.log(x / o)))


def gravity_rate(rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per sample: how fast the slow gravity direction turns (rad/s) and the gyro counts across it."""
    t = rows[:, 0] / 1000.0
    acc = rows[:, 1:4]
    k = 15  # ~0.15 s moving average
    ker = np.ones(k) / k
    low = np.stack([np.convolve(acc[:, c], ker, mode="same") for c in range(3)], axis=1)
    g = low / np.maximum(1e-9, np.linalg.norm(low, axis=1, keepdims=True))
    dt = np.maximum(1e-3, np.gradient(t))
    turn = np.linalg.norm(np.gradient(g, axis=0) / dt[:, None], axis=1)
    gy = rows[:, 4:7]
    across = np.linalg.norm(gy - (gy * g).sum(axis=1, keepdims=True) * g, axis=1)
    s = slice(k, len(rows) - k)
    return turn[s], across[s]


def calibrate(files: dict[tuple[int, str, str], np.ndarray]) -> dict:
    """Scales and axis names, read off the archive: counts per g (still files), counts per degree a second (how
    fast gravity turns in the nod files against the gyro), and per ear side the gyro axis that moves most in the
    nod files (pitch) and in the shake files (yaw)."""
    still = [f for (p, act, side), f in files.items() if act == "still"]
    mag = float(np.median(np.concatenate([np.linalg.norm(f[:, 1:4], axis=1) for f in still])))
    turns, acrosses = [], []
    for (p, act, side), f in files.items():
        if act in ("nod", "tilt"):
            a, b = gravity_rate(f)
            turns.append(a); acrosses.append(b)
    turn = np.concatenate(turns); across = np.concatenate(acrosses)
    moving = turn > np.quantile(turn, 0.5)
    per_rad = float((across[moving] * turn[moving]).sum() / (turn[moving] ** 2).sum())
    per_dps_est = per_rad * np.pi / 180.0
    axes = {}
    for side in ("left", "right"):
        rms = {}
        for act in ("nod", "shake"):
            fs = [f for (p, a, s), f in files.items() if a == act and s == side]
            rms[act] = np.sqrt(np.mean(np.concatenate([f[:, 4:7] - f[:, 4:7].mean(0) for f in fs]) ** 2, axis=0))
        pitch = int(np.argmax(rms["nod"]))
        order = np.argsort(-rms["shake"])
        yaw = int(order[0]) if int(order[0]) != pitch else int(order[1])
        roll = ({0, 1, 2} - {pitch, yaw}).pop()
        axes[side] = {"x": pitch, "y": roll, "z": yaw, "nod_rms": rms["nod"].round(1).tolist(), "shake_rms": rms["shake"].round(1).tolist()}
    return {
        "counts_per_g_measured": mag, "counts_per_g": nearest(mag, STANDARD_G),
        "counts_per_dps_estimated": per_dps_est, "counts_per_dps": nearest(per_dps_est, STANDARD_DPS),
        "axes": axes,
    }


def user_acceleration(acc_g: np.ndarray, gyr_rad: np.ndarray, t_s: np.ndarray, tau: float = 1.0, sign: float = 1.0) -> np.ndarray:
    """Gravity out: a complementary filter (gyro turns the gravity estimate, the accelerometer pulls it back)."""
    n = len(acc_g)
    out = np.empty_like(acc_g)
    g = acc_g[0] / max(1e-9, np.linalg.norm(acc_g[0]))
    for i in range(n):
        dt = 0.0 if i == 0 else min(0.05, max(0.0, t_s[i] - t_s[i - 1]))
        w = gyr_rad[i] * sign
        g = g - dt * np.cross(w, g)
        alpha = tau / (tau + dt) if dt > 0 else 1.0
        a = acc_g[i]
        na = np.linalg.norm(a)
        if na > 1e-6:
            g = alpha * g + (1 - alpha) * a / na
        g = g / max(1e-9, np.linalg.norm(g))
        out[i] = a - g
    return out


def convert(rows: np.ndarray, side: str, cal: dict, sign: float = 1.0) -> np.ndarray:
    """(n, 7) EarSet rows -> (m, 6) on a 50-a-second grid: ax, ay, az in g without gravity, rx, ry, rz in deg/s,
    named like the AirPods' axes."""
    t = rows[:, 0] / 1000.0
    acc = rows[:, 1:4] / cal["counts_per_g"]
    dps = rows[:, 4:7] / cal["counts_per_dps"]
    dps = dps - np.median(dps, axis=0)   # gyro offset
    user = user_acceleration(acc, np.deg2rad(dps), t, sign=sign)
    ax = cal["axes"][side]
    perm = [ax["x"], ax["y"], ax["z"]]
    six = np.concatenate([user[:, perm], dps[:, perm]], axis=1)
    grid = np.arange(t[0], t[-1], 1.0 / HZ)
    return np.stack([np.interp(grid, t, six[:, c]) for c in range(6)], axis=1).astype(np.float32)


def windows(six: np.ndarray, seconds: float = 2.0, stride_s: float = 0.5) -> np.ndarray:
    n = int(round(seconds * HZ)); step = int(round(stride_s * HZ))
    if len(six) < n:
        return np.zeros((0, n, 6), np.float32)
    starts = np.arange(0, len(six) - n + 1, step)
    return np.stack([six[s:s + n] for s in starts]).astype(np.float32)
