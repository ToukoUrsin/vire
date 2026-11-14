#!/usr/bin/env bash
# Builds the fake-camera / fake-mic files for lab-e2e.mjs. Nothing here goes into git.
#   talk.mjpeg + talk.wav   real talking face, 41 s (White House weekly address 2016-08-13, public domain, Wikimedia Commons)
#   talk_flip.mjpeg         the same, mirrored (yaw sign check)
#   smile.mjpeg             real smile: 6 s neutral, a 3.3 s closed-mouth smile, 4 s neutral; loops every 13.333 s
#                           ("20140529 - Smiling.webm", Wikimedia Commons, CC BY-SA 3.0)
#   evm.y4m                 still real face with a visible pulse, 20 s forward+reverse (MIT CSAIL Eulerian Video Magnification "face")
#   pulse72.y4m             still frame + synthetic 72 bpm pulse, 20 s (loops seamlessly)
#   still.jpg               the still frame, for lab-webkit.mjs (it paints the frame + a 72 bpm tint into a canvas camera)
#   swing66.y4m             still frame + synthetic pulse, 66 bpm swinging +-6 bpm every 10 s, 60 s (loops seamlessly)
set -euo pipefail
OUT=${1:-/bulk2/runs/depression/sense-fixtures}
HERE=$(cd "$(dirname "$0")" && pwd)
UA="Mozilla/5.0 (X11; Linux x86_64) fixture-fetch/1.0"
mkdir -p "$OUT/src"
cd "$OUT"
[ -s src/talk.webm ] || curl -sL -A "$UA" -o src/talk.webm "https://upload.wikimedia.org/wikipedia/commons/c/c6/20160813_Weekly_Address_HD.webm"
[ -s src/smiling.webm ] || curl -sL -A "$UA" -o src/smiling.webm "https://upload.wikimedia.org/wikipedia/commons/b/b9/20140529_-_Smiling.webm"
[ -s src/evm_face.mp4 ] || curl -sL -A "$UA" -o src/evm_face.mp4 "http://people.csail.mit.edu/mrub/evm/video/face.mp4"
CROP="crop=720:960:555:0,scale=480:640,fps=30"
ffmpeg -v error -y -ss 142 -t 41 -i src/talk.webm -an -vf "$CROP" -q:v 2 -f mjpeg talk.mjpeg
ffmpeg -v error -y -ss 142 -t 41 -i src/talk.webm -an -vf "$CROP,hflip" -q:v 2 -f mjpeg talk_flip.mjpeg
ffmpeg -v error -y -ss 142 -t 41 -i src/talk.webm -vn -ac 1 -ar 48000 -c:a pcm_s16le talk.wav
# whole frame, not cropped or padded: the smile score moves +-30% with framing (0.15 letterboxed, 0.21 here, 0.24 cropped tight)
ffmpeg -v error -y -i src/smiling.webm -an -vf "fps=30,scale=640:360,tpad=start_mode=clone:start_duration=6:stop_mode=clone:stop_duration=4" -q:v 2 -f mjpeg smile.mjpeg
ffmpeg -v error -y -i src/evm_face.mp4 -an -filter_complex "[0:v]fps=30,scale=480:-2,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1" -pix_fmt yuv420p evm.y4m
ffmpeg -v error -y -ss 150 -i src/talk.webm -frames:v 1 -vf "crop=720:960:555:0,scale=480:640" -f rawvideo -pix_fmt rgb24 src/still.rgb
ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s 480x640 -i src/still.rgb -frames:v 1 -q:v 3 still.jpg
python3 -I "$HERE/synth_pulse.py" src/still.rgb 480 640 20 steady72 | ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s 480x640 -r 30 -i - -pix_fmt yuv420p pulse72.y4m
python3 -I "$HERE/synth_pulse.py" src/still.rgb 480 640 60 swing66 | ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s 480x640 -r 30 -i - -pix_fmt yuv420p swing66.y4m
ls -la "$OUT"
