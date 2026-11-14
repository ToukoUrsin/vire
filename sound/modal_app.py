"""Vire adaptive sound service.

The endpoint returns JSON for beds (base64 MP3 plus generation metadata) and an MP3
for cues.  Model weights are kept in a Modal Volume, so a warm container only
needs to run the 20 second generation.  The prompt mapping below is the single
source of truth for pace and calm: pace becomes a BPM target; calm lowers the
target, removes rhythmic language, and asks for darker, sparser layers.
"""
from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import tempfile
import time
from typing import Any

import modal
from fastapi import Request

app = modal.App("vire-sound")
AUTH_HEADER_NAME = "x-vire-sound-token"
models = modal.Volume.from_name("vire-sound-models", create_if_missing=True)
sound_secret = modal.Secret.from_name("vire-sound-token")
# The CUDA runtime image supplies torch without downloading a second multi-GB
# CUDA wheel during every image build.  Kokoro is optional: the class tries it
# first when present, and the service explicitly reports no voice otherwise.
image = (
    modal.Image.from_registry("pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime")
    .apt_install("ffmpeg")
    .pip_install("fastapi", "transformers==4.47.1", "accelerate", "scipy", "soundfile", "numpy")
)

MODEL_CANDIDATES = ["facebook/musicgen-small", "facebook/musicgen-medium"]
CUES = {
    "settle": "Sit comfortably. Follow the sound.",
    "in": "Breathe in as the sound rises.",
    "out": "And out as it falls.",
    "shoulders": "Let your shoulders drop.",
    "rest": "Now just sit. Breathe as you like.",
    "feet": "Notice your feet.",
    "hands": "Notice your hands.",
    "face": "Notice your face. Let it soften.",
    "walk": "Stand up, and walk at your own pace.",
    "done": "That's it. Well done.",
}


def prompt_for(kind: str, stage: str, pace: float, calm: float) -> str:
    """Map the phone's controls into stable, auditable prompt language."""
    bpm = round(max(4.5, min(14.0, pace)) * 2)
    calm = max(0.0, min(1.0, calm))
    darkness = "very dark, sparse and slow" if calm >= 0.8 else "dark, spacious and gentle" if calm >= 0.55 else "warm, soft and spacious"
    texture = {"breathe": "air and a low breathing-like swell", "scan": "soft wind and warm room tone", "walk": "quiet footsteps implied by texture and distant leaves"}.get(kind, "soft natural texture")
    phase = {"settle": "welcoming and settling", "deep": "deeply steady", "rest": "resting and open"}.get(stage, "steady")
    return f"{darkness} ambient drone, {texture}, {phase}, no drums, no percussion, no beat, no melody, no vocals, no sudden changes, approximately {bpm} BPM breathing pace"


def ffmpeg_mp3(samples: Any, sample_rate: int) -> bytes:
    import numpy as np
    import soundfile as sf

    a = np.asarray(samples).squeeze()
    if a.ndim == 1:
        a = np.column_stack([a, a])
    elif a.shape[0] < a.shape[1] and a.shape[0] <= 4:
        a = a.T
    a = a.astype("float32")
    # Two short fades make server-side cross-fading click-free.
    fade = min(int(sample_rate * 1.5), max(1, len(a) // 3))
    ramp = np.linspace(0.0, 1.0, fade, dtype="float32")
    a[:fade] *= ramp[:, None]
    a[-fade:] *= ramp[::-1, None]
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 0.98:
        a *= 0.96 / peak
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "segment.wav")
        mp3 = os.path.join(td, "segment.mp3")
        sf.write(wav, a, sample_rate, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-af", "loudnorm=I=-19:TP=-1.5:LRA=7", "-codec:a", "libmp3lame", "-b:a", "128k", mp3], check=True)
        with open(mp3, "rb") as f:
            return f.read()


@app.cls(image=image, gpu="T4", volumes={"/models": models}, secrets=[sound_secret], scaledown_window=300, timeout=180)
class SoundGenerator:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = None
        self.model = None
        self.model_name = ""
        errors: list[str] = []
        for name in MODEL_CANDIDATES:
            try:
                self.processor = AutoProcessor.from_pretrained(name, cache_dir="/models")
                self.model = MusicgenForConditionalGeneration.from_pretrained(name, cache_dir="/models").to(self.device)
                self.model_name = name
                break
            except Exception as exc:  # keep the second open model as a real fallback
                errors.append(f"{name}: {exc}")
        if self.model is None:
            raise RuntimeError("could not load an open MusicGen model: " + " | ".join(errors))
        self.kokoro = None
        try:
            from kokoro import KPipeline
            self.kokoro = KPipeline(lang_code="a")
        except Exception:
            # Voice is optional; the bed endpoint remains useful when Kokoro's
            # optional phonemizer is unavailable on a particular image.
            self.kokoro = None

    def _bed(self, item: dict[str, Any]) -> tuple[bytes, str, str, float]:
        import torch

        kind = str(item.get("kind", "breathe"))
        stage = str(item.get("stage", "settle"))
        pace = float(item.get("pace", 6.0))
        calm = float(item.get("calm", 0.7))
        prompt = prompt_for(kind, stage, pace, calm)
        seed = int(item.get("seed", 0) or 0)
        torch.manual_seed(seed)
        inputs = self.processor(text=[prompt], padding=True, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            audio = self.model.generate(**inputs, max_new_tokens=1024, do_sample=True, guidance_scale=3.0)
        samples = audio[0].detach().float().cpu().numpy()
        rate = int(self.model.config.audio_encoder.sampling_rate)
        return ffmpeg_mp3(samples, rate), self.model_name, prompt, samples.shape[-1] / rate

    @modal.fastapi_endpoint(method="POST")
    def generate(self, item: dict[str, Any], request: Request):
        from fastapi.responses import JSONResponse, Response

        started = time.perf_counter()
        expected = os.environ.get("VIRE_SOUND_TOKEN", "")
        provided = request.headers.get(AUTH_HEADER_NAME, "") or request.headers.get("authorization", "")
        if not expected or (provided != expected and provided != f"Bearer {expected}"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        if item.get("kind") == "cue":
            if self.kokoro is None:
                return JSONResponse({"error": "Kokoro unavailable"}, status_code=501)
            text = str(item.get("text", ""))
            import numpy as np
            chunks = [audio for _, _, audio in self.kokoro(text, voice="af_heart", speed=0.86)]
            if not chunks:
                return JSONResponse({"error": "Kokoro returned no audio"}, status_code=502)
            raw = np.concatenate(chunks)
            data = ffmpeg_mp3(raw, 24000)
            return Response(data, media_type="audio/mpeg", headers={"x-model": "kokoro-82m", "x-seconds": str(round(raw.shape[-1] / 24000, 3)), "x-ms": str(round((time.perf_counter() - started) * 1000))})
        data, model, prompt, seconds = self._bed(item)
        body = {"audio_base64": base64.b64encode(data).decode("ascii"), "model": model, "prompt": prompt, "seconds": round(seconds, 3), "gpu": "T4", "ms": round((time.perf_counter() - started) * 1000)}
        return JSONResponse(body)


@app.local_entrypoint()
def main():
    print("vire-sound deploys with a T4 and a 300-second scale-down window")
