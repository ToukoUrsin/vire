#!/usr/bin/env python3
"""Fetch candidate face clips from Mixkit (free licence, no account) and turn each into a fake-camera file.

    python3 -I validation/fetch_clips.py            # scrape category pages -> candidates.json, download, convert

Under /bulk2/runs/depression/validation/smile/:
    pages/mixkit_<category>.html   the category pages the candidates came from
    candidates.json                id, slug (the title), categories
    src/<id>.mp4                   the clip as downloaded (720p, else 360p)
    cam/<id>.y4m                   first 14 s, whole frame scaled to 640x360 (or 360x640), native frame rate (<= 30),
                                   frame index stamped in the corner (stamp_y4m.py)
    cam/<id>.json                  frames, fps, size
Mixkit Stock Video Free License: free to use, not to be redistributed as stock. Clips stay out of git.
"""
import glob
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/bulk2/runs/depression/validation/smile"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
CATS = "smiling laughing portrait face serious talking smile happy man woman old-man elderly beard glasses selfie video-call webcam close-up sad thinking businessman african-american asian black-woman grandmother grandfather teenager vlog interview looking-at-camera".split()
# titles that suggest one person facing the camera
KW = re.compile(r"portrait|at-the-camera|to-the-camera|at-a-camera|at-camera|close-up|closeup|face|selfie|video-call|webcam|smil|laugh|serious|talking|speaking|vlog|interview")
# every clip on these pages is a candidate (they widen the spread of skin tone, age, beards, glasses)
WIDE = {"african-american", "asian", "black-woman", "old-man", "elderly", "grandmother", "grandfather", "beard", "glasses"}
BAD = re.compile(
    r"couple|friends|group|family|kids|children|baby|dog|cat-|team|people|crowd|two-|three-|women-|men-|girls|boys|dancing|running|walking|beach|silhouette|back-|from-behind|"
    r"hands|feet|eye-|eyes|lips|mouth|mask|makeup|make-up|animation|3d|cartoon|icon|emoji|barber|haircut|laptop|champagne|cockatoo|rooster|textbook|ghost|nun|catrina|gangster|"
    r"blue-eye|cyberpunk|wedding|cream|fluorescent|scared|pool|colleagues|mother-and|man-and-woman|explorers|reporters|sign-language|behind-the-scenes|documents|police|detective|"
    r"candidate|psychologist|employer|chess|carousel|profile-|drone|aerial|city|street-food|cooking|kitchen|car-|driving|bike|sport|gym|yoga|sunset|forest|field|food|eating|drinking"
)


def scrape():
    os.makedirs(f"{ROOT}/pages", exist_ok=True)
    for c in CATS:
        p = f"{ROOT}/pages/mixkit_{c}.html"
        if not os.path.exists(p):
            subprocess.run(["curl", "-sL", "-m", "30", "-A", UA, "-o", p, f"https://mixkit.co/free-stock-video/{c}/"], check=False)
    cands = {}
    for p in sorted(glob.glob(f"{ROOT}/pages/mixkit_*.html")):
        cat = os.path.basename(p)[7:-5]
        with open(p, encoding="utf8", errors="ignore") as f:
            s = f.read()
        for m in re.finditer(r'href="/free-stock-video/([a-z0-9-]+)-(\d+)/"', s):
            c = cands.setdefault(m.group(2), {"id": m.group(2), "slug": m.group(1), "cats": []})
            if cat not in c["cats"]:
                c["cats"].append(cat)
    sel = [c for c in cands.values() if not BAD.search(c["slug"]) and (KW.search(c["slug"]) or WIDE & set(c["cats"]))]
    sel.sort(key=lambda c: int(c["id"]))
    with open(f"{ROOT}/candidates.json", "w") as f:
        json.dump(sel, f, indent=0)
    return sel


def one(c):
    vid = c["id"]
    src = f"{ROOT}/src/{vid}.mp4"
    y4m = f"{ROOT}/cam/{vid}.y4m"
    meta = f"{ROOT}/cam/{vid}.json"
    if os.path.exists(meta):
        return vid, "have"
    try:
        if not os.path.exists(src):
            for res in ("720", "360", "1080"):
                r = subprocess.run(["curl", "-sL", "-f", "-m", "180", "-A", UA, "-o", src + ".part", f"https://assets.mixkit.co/videos/{vid}/{vid}-{res}.mp4"], check=False)
                if r.returncode == 0 and os.path.getsize(src + ".part") > 50000:
                    os.rename(src + ".part", src)
                    break
            else:
                return vid, "FAILED download"
        info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,duration", "-of", "json", src], capture_output=True, text=True, timeout=60, check=True).stdout)["streams"][0]
        num, den = (int(x) for x in info["avg_frame_rate"].split("/"))
        fps = num / den
        play = int(round(fps))
        vf = []
        if play > 30:
            play = int(round(fps / 2))
            vf.append("select='not(mod(n\\,2))'")
        w, h = (640, 360) if int(info["width"]) >= int(info["height"]) else (360, 640)
        vf.append(f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}")
        frames = 14 * play
        ff = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-an", "-vf", ",".join(vf), "-vsync", "0", "-frames:v", str(frames), "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], stdout=subprocess.PIPE)
        with open(y4m + ".part", "wb") as fo:
            st = subprocess.run([sys.executable, "-I", os.path.join(HERE, "stamp_y4m.py"), str(w), str(h), str(play), "1"], stdin=ff.stdout, stdout=fo, stderr=subprocess.PIPE, text=True, timeout=600)
        ff.wait()
        n = int(st.stderr.strip().split("\n")[-1])
        os.rename(y4m + ".part", y4m)
        with open(meta, "w") as f:
            json.dump({"id": vid, "slug": c["slug"], "cats": c["cats"], "frames": n, "fps": play, "srcFps": round(fps, 3), "width": w, "height": h, "srcWidth": int(info["width"]), "srcHeight": int(info["height"])}, f)
        return vid, f"ok {n} frames at {play} fps"
    except Exception as e:  # noqa: BLE001
        return vid, f"FAILED {type(e).__name__}: {str(e)[:160]}"


def main():
    sel = scrape()
    os.makedirs(f"{ROOT}/src", exist_ok=True)
    os.makedirs(f"{ROOT}/cam", exist_ok=True)
    print(len(sel), "candidates", flush=True)
    with ThreadPoolExecutor(10) as ex:
        for vid, msg in ex.map(one, sel):
            print(vid, msg, flush=True)


if __name__ == "__main__":
    main()
