#!/usr/bin/env python3
"""Fetch UBFC-rPPG DATASET_2 (Bobbia et al. 2017) from the authors' public Google Drive folder and turn every
video into a fake-camera file for headless Chrome.

    python3 -I validation/fetch_ubfc.py [--workers 6] [--only subject1,subject3]

Per subject, under /bulk2/runs/depression/validation/pulse/ubfc/DATASET_2/<subject>/:
    ground_truth.txt   contact PPG wave, the oximeter's own HR, timestamps (one column per video frame)
    cam.y4m            the video, yuv420p, frame index stamped in the corner (stamp_y4m.py). Its header says 5 fps:
                       it is played slowly and the page clock is slowed to match (see "warp" in run_lab.mjs).
    meta.json          frames, size, capture fps from the ground-truth timestamps, playFps = the integer camera
                       rate the page is made to see
The raw vid.avi (about 1.5 GB each) is deleted after conversion. Nothing here goes into git; the dataset is
for research use and is not redistributed (see validation/README.md).
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/bulk2/runs/depression/validation/pulse/ubfc"
FOLDER = "https://drive.google.com/drive/folders/1o0XU4gTIo46YfwaWjIgbtCncc-oF44Xk"
LIST = os.path.join(ROOT, "list.json")


def listing():
    if not os.path.exists(LIST):
        os.makedirs(ROOT, exist_ok=True)
        out = subprocess.run(["gdown", "--no-cookies", "--json", FOLDER], capture_output=True, text=True, timeout=600, check=True).stdout
        with open(LIST, "w") as f:
            f.write(out)
    with open(LIST) as f:
        return json.load(f)


UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def download(url, dest, min_bytes, timeout):
    """gdown first; when its link lookup is throttled, the same public file from Drive's direct download address."""
    part = dest + ".part"
    try:
        subprocess.run(["gdown", "--no-cookies", "-q", "--retries", "2", "-O", part, url], timeout=timeout, check=True, capture_output=True)
    except Exception:  # noqa: BLE001
        fid = url.split("id=")[1]
        subprocess.run(["curl", "-sL", "-f", "-m", str(timeout), "-A", UA, "-o", part, f"https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t"], timeout=timeout + 30, check=True)
    with open(part, "rb") as f:
        head = f.read(200).lstrip().lower()
    if os.path.getsize(part) < min_bytes or head.startswith(b"<!doctype html") or head.startswith(b"<html"):
        os.remove(part)
        raise RuntimeError("Drive did not return the file (quota page or too small)")
    os.rename(part, dest)


def gt_fps(path):
    with open(path) as f:
        lines = [ln.split() for ln in f.read().strip().split("\n")]
    t = [float(x) for x in lines[2]]
    return len(t), (len(t) - 1) / (t[-1] - t[0])


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames,codec_name,pix_fmt", "-of", "json", path],
        capture_output=True, text=True, timeout=120, check=True,
    ).stdout
    return json.loads(out)["streams"][0]


def one(sub, files):
    d = os.path.join(ROOT, "DATASET_2", sub)
    os.makedirs(d, exist_ok=True)
    meta_path = os.path.join(d, "meta.json")
    if os.path.exists(meta_path) and os.path.exists(os.path.join(d, "cam.y4m")):
        return sub, "have"
    gt = os.path.join(d, "ground_truth.txt")
    avi = os.path.join(d, "vid.avi")
    try:
        if not os.path.exists(gt):
            download(files["ground_truth.txt"], gt, 10_000, 300)
        if not os.path.exists(avi):
            download(files["vid.avi"], avi, 100_000_000, 3600)
        info = probe(avi)
        w, h = int(info["width"]), int(info["height"])
        n_gt, fps = gt_fps(gt)
        # The page is made to see an integer camera rate (playFps); the true capture rate is kept in meta.json
        # and score_pulse.py converts every frequency back with it. The file itself plays at 10/2 = 5 fps.
        play = int(round(fps))
        y4m = os.path.join(d, "cam.y4m")
        ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", avi, "-an", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], stdout=subprocess.PIPE)
        with open(y4m + ".part", "wb") as fo:
            st = subprocess.run([sys.executable, "-I", os.path.join(HERE, "stamp_y4m.py"), str(w), str(h), "10", "2"], stdin=ff.stdout, stdout=fo, stderr=subprocess.PIPE, text=True, timeout=3600)
        ff.wait()
        frames = int(st.stderr.strip().split("\n")[-1])
        os.rename(y4m + ".part", y4m)
        with open(meta_path, "w") as f:
            json.dump({"subject": sub, "width": w, "height": h, "frames": frames, "gtSamples": n_gt, "captureFps": round(fps, 4), "playFps": play, "avi": info}, f)
        os.remove(avi)
        return sub, f"ok {frames} frames, gt {n_gt}, fps {fps:.3f}"
    except Exception as e:  # noqa: BLE001
        return sub, f"FAILED {type(e).__name__}: {str(e)[:200]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    subs = {}
    for e in listing():
        p = e["path"].split("/")
        if len(p) == 3 and p[0] == "DATASET_2":
            subs.setdefault(p[1], {})[p[2]] = e["url"]
    names = sorted(subs, key=lambda s: int(s.replace("subject", "")))
    if a.only:
        names = [s for s in names if s in a.only.split(",")]
    with ThreadPoolExecutor(a.workers) as ex:
        for sub, msg in ex.map(lambda s: one(s, subs[s]), names):
            print(sub, msg, flush=True)


if __name__ == "__main__":
    main()
