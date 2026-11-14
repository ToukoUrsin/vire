#!/usr/bin/env python3
"""Draw the Vire app icon: an ember dot (the ping) and four echoes (smile, voice, heart, move)."""
import math
import sys
from PIL import Image, ImageDraw

S = 4096
img = Image.new("RGB", (S, S), "#14110d")
d = ImageDraw.Draw(img)
cx, cy = int(S * 0.25), S // 2
w = int(S * 0.05)
rings = [("#e9a23b", 0.17, 48), ("#2a9d8f", 0.30, 44), ("#d1495b", 0.43, 40), ("#5b6abf", 0.56, 36)]
for colour, r, half in rings:
    R = int(S * r)
    d.arc([cx - R, cy - R, cx + R, cy + R], -half, half, fill=colour, width=w)
    for a in (-half, half):
        x = cx + (R - w / 2) * math.cos(math.radians(a))
        y = cy + (R - w / 2) * math.sin(math.radians(a))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=colour)
r0 = int(S * 0.07)
d.ellipse([cx - r0, cy - r0, cx + r0, cy + r0], fill="#e4572e")
img.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
