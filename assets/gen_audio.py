#!/usr/bin/env python3
"""Generate Vire's audio with ElevenLabs (sound effects + voice guide), then normalise into web/public/audio.

Run: hsec exec --only ELEVENLABS_API_KEY -- python3 assets/gen_audio.py [name ...]
Raw files land in assets/gen/, finished ones in web/public/audio/. Existing raw files are kept (delete to regenerate).
"""
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "gen")
OUT = os.path.join(ROOT, "web", "public", "audio")
KEY = os.environ["ELEVENLABS_API_KEY"]
VOICE = "EXAVITQu4vr4xnSDxMaL"  # Sarah: mature, reassuring

# name: (prompt, seconds, loop, mono, target LUFS)
SFX = {
    "laugh-1": ("A baby giggling uncontrollably, pure contagious belly laughter, close microphone, clean recording, no music", 8, False, False, -16),
    "laugh-2": ("A woman bursting into warm infectious laughter, tries to stop and cracks up again, close microphone, clean, no music", 9, False, False, -16),
    "laugh-3": ("A small group of friends cracking up laughing together, genuine contagious laughter, indoor, no music, no talking", 9, False, False, -16),
    "chime": ("A single soft warm bell chime, gentle, short decay, no reverb tail noise", 2, False, False, -18),
    "found": ("A tiny sparkling magical chime, bright and positive, very short", 1.5, False, False, -18),
    "breath-in": ("A soft airy rising whoosh like one slow calm inhale, smooth, gentle, no voice", 5, False, False, -22),
    "breath-out": ("A soft airy falling whoosh like one slow calm exhale, smooth, gentle, no voice", 5, False, False, -22),
    "forest-bed": ("Calm boreal forest ambience at dawn, light wind in birch leaves, very distant birds, no rain, no people", 22, True, False, -24),
    "stream": ("A gentle small forest stream trickling over stones, close and clear, no birds", 15, True, True, -24),
    "bird-1": ("A single blackbird singing one short melodic phrase, isolated, close, no background noise", 3, False, True, -18),
    "bird-2": ("A single European robin singing a short bright phrase, isolated, close, no background noise", 3, False, True, -18),
    "bird-3": ("A single chaffinch song, one short descending phrase, isolated, close, no background noise", 3, False, True, -18),
    "bird-4": ("A great tit two-note call repeated three times, isolated, close, no background noise", 3, False, True, -18),
    "bird-5": ("A cuckoo calling twice, isolated, clear, no background noise", 3, False, True, -18),
    "bird-6": ("A willow warbler singing one soft descending phrase, isolated, close, no background noise", 3, False, True, -18),
}

VO = {
    "vo-settle": "Hi. Just look here, and rest for a moment.",
    "vo-nod": "Nod when you're ready.",
    "vo-listen": "Here's something for you.",
    "vo-speak-1": "Out loud: what's one thing you're looking forward to?",
    "vo-speak-2": "Out loud: tell me about something small that went well lately.",
    "vo-speak-3": "Out loud: what did you eat today, and how was it?",
    "vo-breathe": "Now, two slow breaths with me.",
    "vo-in": "Breathe in.",
    "vo-out": "And out.",
    "vo-done": "That's it. Here's your echo.",
    "vo-dose-breathe": "Breathe with the sound. In as it rises, out as it falls.",
    "vo-dose-forest": "Somewhere around you, a bird is calling. Turn your head to find it.",
    "vo-dose-walk": "Let's walk. Follow the beat, a touch faster than usual.",
    "vo-dose-reach": "Think of one person. Send them ten seconds of your voice.",
    "vo-mini": "One more quick listen, and one slow breath.",
    "vo-tune-intro": "Let's teach Vire your face. Five faces, a few seconds each.",
    "vo-tune-rest": "First, rest your face.",
    "vo-tune-smile": "Now your biggest smile.",
    "vo-tune-sad": "Pull the corners of your mouth down.",
    "vo-tune-angry": "Lower your brows, like you're cross.",
    "vo-tune-surprised": "Raise your brows, like you're surprised.",
    "vo-tune-done": "That's it. Vire knows your face.",
}


def post(url, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"xi-api-key": KEY, "content-type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def gen(name):
    raw = os.path.join(RAW, name + ".mp3")
    if not os.path.exists(raw) or os.path.getsize(raw) < 2000:
        if name in SFX:
            prompt, secs, loop, _, _ = SFX[name]
            body = {"text": prompt, "duration_seconds": secs, "prompt_influence": 0.5}
            if loop:
                body["loop"] = True
            data = post("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", body)
        else:
            body = {
                "text": VO[name],
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.6, "similarity_boost": 0.8, "style": 0.15, "speed": 0.92},
            }
            data = post(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128", body)
        with open(raw, "wb") as f:
            f.write(data)
    mono = SFX[name][3] if name in SFX else True
    lufs = SFX[name][4] if name in SFX else -17
    out = os.path.join(OUT, name + ".mp3")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", f"loudnorm=I={lufs}:TP=-1.5:LRA=11"]
    if mono:
        cmd += ["-ac", "1"]
    cmd += ["-ar", "44100", "-b:a", "128k", out]
    subprocess.run(cmd, check=True)
    return name, os.path.getsize(out)


if __name__ == "__main__":
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(SFX) + list(VO)
    with cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(gen, n): n for n in names}
        for fut in cf.as_completed(futs):
            try:
                print("ok", *fut.result())
            except Exception as e:  # noqa: BLE001
                detail = e.read().decode()[:300] if hasattr(e, "read") else ""
                print("FAIL", futs[fut], e, detail)
