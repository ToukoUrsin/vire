#!/usr/bin/env bash
# Step 2 of 2: build the film from the capture and render it. First: film/capture.sh [baseUrl]
#   film/render.sh vN        -> /bulk2/runs/depression/film/out/vire-demo-vN.mp4 (+ contact sheet, loudness log)
# film/scripts/build.mjs writes film/index.html from the capture's own numbers, timings and layout, the narration
# (film/assets/vo) and web/public/validation.json. Nothing is placed by hand.
set -euo pipefail
VER="${1:?usage: film/render.sh vN}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="/bulk2/runs/depression/film"
CAP="${CAP:-$RUN/capture}"
AS="$ROOT/film/assets/capture"
OUT="$RUN/out"
mkdir -p "$AS" "$OUT"
[ -s "$CAP/meta.json" ] || { echo "render: no capture in $CAP (run film/capture.sh first)" >&2; exit 2; }
# the recordings stay outside the repo; the film reads them through links
find "$AS" -maxdepth 1 -type l -delete
for f in "$CAP"/*.mp4 "$CAP"/snd-*.wav "$CAP/meta.json"; do
  [ -s "$f" ] && ln -sfn "$f" "$AS/$(basename "$f")"
done
cd "$ROOT/film"
node scripts/build.mjs
set +e
npx hyperframes check --json > "$RUN/check-$VER.json" 2> "$RUN/check-$VER.err"
CHECK_STATUS=$?
set -e
if [ "$CHECK_STATUS" -ne 0 ]; then
  if [ ! -s "$RUN/check-$VER.json" ]; then echo "render: HyperFrames check failed without a report ($RUN/check-$VER.err)" >&2; exit "$CHECK_STATUS"; fi
  # only a broken composition stops the render; layout and contrast notes are for the editor (see film/README.md)
  CHECK_ERRORS="$(jq '[.lint.errorCount // 0, .runtime.errorCount // 0, .audio.errorCount // 0] | add' "$RUN/check-$VER.json" 2>/dev/null || echo 0)"
  if [ "$CHECK_ERRORS" -gt 0 ]; then echo "render: HyperFrames check found $CHECK_ERRORS errors ($RUN/check-$VER.json)" >&2; exit 3; fi
fi
TMP="$RUN/.vire-hf-$VER.mp4"
npx hyperframes render --quality "${QUALITY:-delivery}" -o "$TMP"
FINAL="$OUT/vire-demo-$VER.mp4"
ffmpeg -y -loglevel error -i "$TMP" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:v copy -c:a aac -b:a 192k -movflags +faststart "$FINAL"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$FINAL" > "$OUT/vire-demo-$VER.probe.txt"
ffmpeg -y -loglevel error -i "$FINAL" -vf "fps=1,scale=320:-1,tile=12x9:padding=6:color=black" -frames:v 1 -q:v 3 "$OUT/vire-demo-$VER-contact.jpg"
ffmpeg -y -loglevel error -i "$FINAL" -af ebur128=peak=true -f null - 2> "$OUT/vire-demo-$VER-ebur.txt" || true
echo "$FINAL"
cat "$OUT/vire-demo-$VER.probe.txt"
