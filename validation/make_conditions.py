#!/usr/bin/env python3
"""Degrade camera files with ffmpeg to mimic a hackathon hall, for the robustness runs.

    python3 -I validation/make_conditions.py pulse subject1,subject3,...   [seconds] [condition,condition]
    python3 -I validation/make_conditions.py smile 4535,4859,...           [seconds] [condition,condition]

Writes /bulk2/runs/depression/validation/robust/<kind>/<id>__<condition>.y4m (slow-playing, see run_lab.mjs
"warp") and prints the run_lab.mjs job lines. Conditions (applied to the decoded frames, before the frame stamp):

    original    untouched (same length as the others, so the comparison is like for like)
    light50     every RGB value x 0.50, plus sensor noise (Gaussian, new every frame, sd about 3 of 255 levels)
    light25     x 0.25, noise sd about 4.6 levels
    light12     x 0.12, noise sd about 5.8 levels      (a dark corner of the hall)
    backlight   x 0.20 + 40/255 offset, noise sd about 4.6: a face under-exposed against a bright window, with the
                washed-out contrast of lens glare. A simulation of the effect on the face, not a real window.
    noise       original light, noise sd about 7.5 levels (a camera at high gain)
    fps15       every second frame dropped (camera at half its frame rate)
    halfres     frame scaled to half width and height (a face half as many pixels wide)
  pulse only, to separate light from noise:
    dim50       x 0.50 and no added noise
    noiseLow    original light, noise sd about 1.2 levels
    noiseMid    original light, noise sd about 2.9 levels (the noise of light50, without the dimming)
ffmpeg's noise filter draws Gaussian noise with sd = strength / sqrt(3) on every plane.
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "/bulk2/runs/depression/validation"
REAL_FPS = 5

CONDITIONS = {
    "original": "",
    "light50": "lutrgb=r=val*0.5:g=val*0.5:b=val*0.5,noise=alls=5:allf=t",
    "light25": "lutrgb=r=val*0.25:g=val*0.25:b=val*0.25,noise=alls=8:allf=t",
    "light12": "lutrgb=r=val*0.12:g=val*0.12:b=val*0.12,noise=alls=10:allf=t",
    "backlight": "lutrgb=r=val*0.2+40:g=val*0.2+40:b=val*0.2+40,noise=alls=8:allf=t",
    "noise": "noise=alls=13:allf=t",
    "fps15": "select='not(mod(n\\,2))'",
    "halfres": "scale=iw/2:ih/2",
    "dim50": "lutrgb=r=val*0.5:g=val*0.5:b=val*0.5",
    "noiseLow": "noise=alls=2:allf=t",
    "noiseMid": "noise=alls=5:allf=t",
}
DEFAULT = ["original", "light50", "light25", "light12", "backlight", "noise", "fps15", "halfres"]


def source(kind, vid):
    if kind == "pulse":
        d = f"{BASE}/pulse/ubfc/DATASET_2/{vid}"
        with open(f"{d}/meta.json") as f:
            m = json.load(f)
        return f"{d}/cam.y4m", m["width"], m["height"], m["playFps"]
    with open(f"{BASE}/smile/cam/{vid}.json") as f:
        m = json.load(f)
    return f"{BASE}/smile/cam/{vid}.y4m", m["width"], m["height"], m["fps"]


def one(args):
    kind, vid, cond, seconds = args
    src, w, h, fps = source(kind, vid)
    out = f"{BASE}/robust/{kind}/{vid}__{cond}.y4m"
    n_in = int(seconds * fps)
    ow, oh = (w // 2, h // 2) if cond == "halfres" else (w, h)
    native = fps / 2 if cond == "fps15" else fps
    vf = CONDITIONS[cond]
    # the stamp in the source corner is degraded with the rest; it is overwritten by the new stamp
    cmd = ["ffmpeg", "-v", "error", "-i", src, "-frames:v", str(n_in), "-an"]
    if vf:
        cmd += ["-vf", f"format=rgb24,{vf}" if "lutrgb" in vf else vf, "-vsync", "0"]
    cmd += ["-f", "rawvideo", "-pix_fmt", "yuv420p", "-"]
    if not os.path.exists(out):
        ff = subprocess.Popen(cmd, stdout=subprocess.PIPE)
        with open(out + ".part", "wb") as fo:
            st = subprocess.run([sys.executable, "-I", f"{HERE}/stamp_y4m.py", str(ow), str(oh), "10", "2"], stdin=ff.stdout, stdout=fo, stderr=subprocess.PIPE, text=True, timeout=1200)
        ff.wait()
        frames = int(st.stderr.strip().split("\n")[-1])
        os.rename(out + ".part", out)
    else:
        frames = (os.path.getsize(out) - 80) // (6 + ow * oh * 3 // 2)
    return {"id": f"{vid}__{cond}", "video": out, "frames": frames, "fps": REAL_FPS, "warp": native / REAL_FPS, "query": "&delegate=cpu", "source": vid, "condition": cond, "nativeFps": native}


def main():
    kind = sys.argv[1]
    ids = sys.argv[2].split(",")
    seconds = float(sys.argv[3]) if len(sys.argv) > 3 else (35 if kind == "pulse" else 14)
    os.makedirs(f"{BASE}/robust/{kind}", exist_ok=True)
    conds = sys.argv[4].split(",") if len(sys.argv) > 4 else DEFAULT
    work = [(kind, v, c, seconds) for v in ids for c in conds]
    with ThreadPoolExecutor(12) as ex:
        for job in ex.map(one, work):
            print(json.dumps(job), flush=True)


if __name__ == "__main__":
    main()
