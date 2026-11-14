#!/usr/bin/env bash
# Step 1 of 2: record the real product for the film. Then: film/render.sh vN
#   film/capture.sh [baseUrl]      default: the public build (stable; the dev server changes under the designer's hands)
# About 9 minutes: Tune, three pings that teach Vire this face's usual, then the film's ping, dose, re-measure and the clinic.
# Everything lands in /bulk2/runs/depression/film/capture (never in the repo).
set -euo pipefail
BASE_URL="${1:-https://vire.fly.dev/}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="/bulk2/runs/depression/film/capture"
CLIPS="$OUT/clips"
# One man posing for the camera at 640x480, the size the app's camera gives (Wikimedia Commons, "20140529 - ...",
# Clement Bucco-Lechat, CC BY-SA 3.0). The film never shows his picture, only what Vire drew and measured from it.
FACE="/bulk2/runs/depression/tune/clips/webm/commons"
SPEECH="/bulk2/runs/depression/sense-fixtures/talk.wav"
mkdir -p "$CLIPS"
for f in smiling frowning surprised; do ln -sf "$FACE/$f.webm" "$CLIPS/$f.webm"; done
enc=(-an -c:v libvpx-vp9 -crf 20 -b:v 0 -g 15 -pix_fmt yuv420p -loglevel error -y)
# a clip is built again when it is missing or this recipe changed
stale() { [ ! -s "$1" ] || [ "$0" -nt "$1" ]; }

# resting face: eyes open and still, one blink every six seconds, loops without a seam
if stale "$CLIPS/rest-loop.webm"; then
  ffmpeg -i "$FACE/smiling.webm" -i "$FACE/blinking.webm" -filter_complex "
    [0:v]trim=0:0.45,setpts=2*(PTS-STARTPTS),fps=30,split=6[a1][a2][a3][b1][b2][b3];
    [b1]reverse,setpts=PTS-STARTPTS[r1];[b2]reverse,setpts=PTS-STARTPTS[r2];[b3]reverse,setpts=PTS-STARTPTS[r3];
    [a1][r1][a2][r2]concat=n=4:v=1,fps=30[open];
    [a3][r3]concat=n=2:v=1,fps=30[tail];
    [1:v]trim=1.4:2.4,setpts=(PTS-STARTPTS)/1.6,fps=30[blink];
    [open][blink]xfade=transition=fade:duration=0.12:offset=3.48[ob];
    [ob][tail]xfade=transition=fade:duration=0.12:offset=3.985[v]" -map "[v]" "${enc[@]}" "$CLIPS/rest-loop.webm"
fi
# A smile from rest and back to rest: on, held, off. "long" is this person's usual (6.0 s); "short" is the quieter
# day in the film (5.6 s, held for less). Both fit inside the 8 s the re-measure listens for, so the re-measure
# reads the same smile as the film's ping: nothing is scripted to get better or worse after the dose.
smile() { # name, where the held smile turns back (s into the source clip)
  ffmpeg -i "$FACE/smiling.webm" -filter_complex "
    [0:v]trim=0.45:2.8,setpts=PTS-STARTPTS,split=2[on][onb];[onb]reverse,setpts=PTS-STARTPTS[off];
    [0:v]trim=$2:2.8,setpts=PTS-STARTPTS,split=2[hold][holdb];[holdb]reverse,setpts=PTS-STARTPTS[back];
    [on][back][hold][off]concat=n=4:v=1,fps=30[v]" -map "[v]" "${enc[@]}" "$CLIPS/$1.webm"
}
if stale "$CLIPS/smile-long.webm"; then smile smile-long 2.15; fi
if stale "$CLIPS/smile-short.webm"; then smile smile-short 2.35; fi

CLINIC_CODE="film-$(date -u +%Y%m%d-%H%M%S)"
run=(node "$DIR/scripts/capture.mjs" --base "$BASE_URL" --out "$OUT" --clips "$CLIPS" --speech "$SPEECH" --name Aino --clinic-code "$CLINIC_CODE")
# This box makes and removes network interfaces all the time (other people's containers), and Chrome drops its
# requests and sockets every time one changes: pages come up blank and the big screen loses the phone. So the
# browser runs in a network of its own (pasta) and reaches the server over the box's tailnet address, with the
# same https address in the bar. Anywhere this cannot be set up, it just runs normally.
HOST="$(node -e 'const u=new URL(process.argv[1]);console.log(u.hostname+" "+(u.port||(u.protocol==="https:"?443:80)))' "$BASE_URL")"
PORT="${HOST#* }"; HOST="${HOST% *}"
IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"
if [[ "$HOST" == *.ts.net ]] && [ -n "$IP" ] && command -v pasta >/dev/null &&
  pasta --config-net -- curl -s --max-time 10 --resolve "$HOST:$PORT:$IP" -o /dev/null "$BASE_URL" 2>/dev/null; then
  MAP="$HOST=$IP"
  for h in fonts.googleapis.com fonts.gstatic.com; do # names do not resolve in there; the app's web fonts still have to load
    a="$(getent ahostsv4 "$h" 2>/dev/null | awk 'NR==1{print $1}' || true)"
    [ -n "$a" ] && MAP="$MAP,$h=$a"
  done
  echo "capture: browser in its own network, $MAP"
  # (the wait lets the new network settle: Chrome drops requests while its addresses are still being set up)
  pasta --config-net -- bash -c 'sleep 3; exec "$@"' _ "${run[@]}" --resolve "$MAP"
else
  "${run[@]}"
fi
