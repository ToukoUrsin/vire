#!/usr/bin/env python3
"""Still face frame + sensor noise + a synthetic pulse with a known heart-rate profile -> raw rgb24 on stdout.

usage: synth_pulse.py frame.rgb W H SECONDS MODE   (MODE: steady72 | swing66 | swing:N)
swing66 is 66 bpm swinging by 12 peak to trough with a 10 s period; swing:N swings by N (validation, heart swing).
The pulse tints the frame the way blood volume does (R 0.33, G 0.77, B 0.53 of the amplitude).
"""
import sys
import numpy as np

path, w, h, seconds, mode = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
fps = 30
amp = 0.008
base = np.fromfile(path, dtype=np.uint8).reshape(h, w, 3).astype(np.float32)
rng = np.random.default_rng(7)
pbv = np.array([0.33, 0.77, 0.53], dtype=np.float32)
phase = 0.0
swing = float(mode.split(':')[1]) if mode.startswith('swing:') else 12.0
out = sys.stdout.buffer
for i in range(int(seconds * fps)):
    t = i / fps
    bpm = 72.0 if mode == 'steady72' else 66.0 + swing / 2.0 * np.sin(2 * np.pi * t / 10.0)
    phase += 2 * np.pi * (bpm / 60.0) / fps
    p = np.cos(phase) + 0.3 * np.cos(2 * phase)
    frame = base * (1.0 + amp * pbv * p) + rng.normal(0, 2.0, base.shape).astype(np.float32)
    out.write(np.clip(frame + 0.5, 0, 255).astype(np.uint8).tobytes())
