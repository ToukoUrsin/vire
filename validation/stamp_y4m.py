#!/usr/bin/env python3
"""Raw yuv420p frames on stdin -> y4m on stdout, with the frame index stamped into the top-left corner.

    ffmpeg -i in.avi -f rawvideo -pix_fmt yuv420p - | python3 -I stamp_y4m.py W H FPS_NUM FPS_DEN [MAX_FRAMES] > out.y4m

The stamp is 16 bits, most significant first, one 8x8 luma block per bit (235 = 1, 16 = 0) in rows 0-7,
and the complement of the same bits in rows 8-15 (so a reader can reject a half-updated frame).
128x16 px of background in the corner; the face is never there. run_lab.mjs reads it back inside the
page, so every number the pipeline emits is tied to the exact video frame it came from.
"""
import sys

import numpy as np

w, h, fn, fd = (int(x) for x in sys.argv[1:5])
max_frames = int(sys.argv[5]) if len(sys.argv) > 5 else 0
if w < 128 or h < 16 or w % 2 or h % 2:
    sys.exit("frame too small or odd-sized for the stamp")
inp = sys.stdin.buffer
out = sys.stdout.buffer
out.write(f"YUV4MPEG2 W{w} H{h} F{fn}:{fd} Ip A1:1 C420mpeg2 XYSCSS=420MPEG2 XCOLORRANGE=LIMITED\n".encode())
ysz = w * h
csz = (w // 2) * (h // 2)
n = 0
while True:
    buf = inp.read(ysz + 2 * csz)
    if len(buf) < ysz + 2 * csz:
        break
    a = np.frombuffer(buf, dtype=np.uint8).copy()
    y = a[:ysz].reshape(h, w)
    u = a[ysz : ysz + csz].reshape(h // 2, w // 2)
    v = a[ysz + csz :].reshape(h // 2, w // 2)
    bits = [(n >> (15 - i)) & 1 for i in range(16)]
    for i, b in enumerate(bits):
        y[0:8, 8 * i : 8 * i + 8] = 235 if b else 16
        y[8:16, 8 * i : 8 * i + 8] = 16 if b else 235
    u[0:8, 0:64] = 128
    v[0:8, 0:64] = 128
    out.write(b"FRAME\n")
    out.write(a.tobytes())
    n += 1
    if max_frames and n >= max_frames:
        break
sys.stderr.write(f"{n}\n")
