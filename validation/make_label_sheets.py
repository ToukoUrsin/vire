#!/usr/bin/env python3
"""Contact sheets for labelling the face clips by eye, without seeing any pipeline score.

    python3 -I validation/make_label_sheets.py <pass1_raw_dir>

For every clip in which the first pipeline pass found a face (>= 60 % of analysed frames, face >= 50 px wide),
six frames spread over the clip are cropped around the face (position from that pass) and tiled in one row.
Sheets go to /bulk2/runs/depression/validation/smile/sheets/sheet_NN.png (8 clips each); sheets.json maps every
row to its clip id and the six frame indices, so each label is tied to exact video frames.
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = "/bulk2/runs/depression/validation/smile"
TILE = 150
PER_SHEET = 8
FRACS = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92]


def read_frame(path, w, h, k):
    fsz = w * h * 3 // 2
    with open(path, "rb") as f:
        head = f.readline()
        f.seek(len(head) + k * (6 + fsz) + 6)
        buf = np.frombuffer(f.read(fsz), np.uint8)
    y = buf[: w * h].reshape(h, w).astype(np.float32)
    u = buf[w * h : w * h + w * h // 4].reshape(h // 2, w // 2).repeat(2, 0).repeat(2, 1).astype(np.float32) - 128
    v = buf[w * h + w * h // 4 :].reshape(h // 2, w // 2).repeat(2, 0).repeat(2, 1).astype(np.float32) - 128
    yy = (y - 16) * 1.164
    rgb = np.stack([yy + 1.596 * v, yy - 0.392 * u - 0.813 * v, yy + 2.017 * u], -1)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def main():
    raw = sys.argv[1]
    os.makedirs(f"{ROOT}/sheets", exist_ok=True)
    rows = []
    for p in sorted(glob.glob(f"{raw}/*.json"), key=lambda s: int(os.path.basename(s)[:-5])):
        with open(p) as f:
            d = json.load(f)
        vid = d["id"]
        with open(f"{ROOT}/cam/{vid}.json") as f:
            m = json.load(f)
        face = [r for r in d["face"] if r[1] is not None and r[1] >= 0]
        if len(face) < 10:
            continue
        pres = [r for r in face if r[3] == 1 and r[16]]
        if len(pres) / len(face) < 0.6:
            continue
        fw = float(np.median([r[16] for r in pres]))
        if fw < 50:
            continue
        ks = np.array([r[1] for r in pres])
        frames = []
        for fr in FRACS:
            k = int(round(fr * (m["frames"] - 1)))
            r = pres[int(np.argmin(np.abs(ks - k)))]
            frames.append({"k": k, "cx": r[17], "cy": r[18], "fw": r[16]})
        rows.append({"id": vid, "frames": frames, "w": m["width"], "h": m["height"], "faceW": round(fw), "presentPass1": round(len(pres) / len(face), 2)})
    index = []
    for s in range(0, len(rows), PER_SHEET):
        chunk = rows[s : s + PER_SHEET]
        sheet = Image.new("RGB", (40 + TILE * len(FRACS), TILE * len(chunk)), (30, 30, 30))
        dr = ImageDraw.Draw(sheet)
        for i, row in enumerate(chunk):
            dr.text((6, i * TILE + 6), f"{s // PER_SHEET + 1}.{i + 1}", fill=(255, 255, 0))
            for j, fr in enumerate(row["frames"]):
                img = read_frame(f"{ROOT}/cam/{row['id']}.y4m", row["w"], row["h"], fr["k"])
                side = max(40, 2.1 * fr["fw"])
                x0 = fr["cx"] * row["w"] - side / 2
                y0 = fr["cy"] * row["h"] - side * 0.55
                tile = img.crop((int(x0), int(y0), int(x0 + side), int(y0 + side))).resize((TILE, TILE), Image.LANCZOS)
                sheet.paste(tile, (40 + j * TILE, i * TILE))
            index.append({"sheet": s // PER_SHEET + 1, "row": i + 1, "id": row["id"], "frames": [fr["k"] for fr in row["frames"]], "faceW": row["faceW"]})
        sheet.save(f"{ROOT}/sheets/sheet_{s // PER_SHEET + 1:02d}.png")
    with open(f"{ROOT}/sheets/sheets.json", "w") as f:
        json.dump(index, f)
    print(len(rows), "clips on", (len(rows) + PER_SHEET - 1) // PER_SHEET, "sheets")


if __name__ == "__main__":
    main()
