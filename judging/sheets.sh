#!/bin/bash
# Contact sheets of a shots.mjs run, for looking at a whole area at once:
#   judging/sheets.sh <shotsDir>      -> <shotsDir>/sheets/<size>-NN.png
# phone: five screens a sheet at 390 wide; laptop: six a sheet (3x2) at 600 wide; wide: four a sheet (2x2) at 800 wide.
# Every tile carries its file name. Sheets are in walk order (the file names sort that way).
set -euo pipefail
dir="${1:?usage: judging/sheets.sh <shotsDir>}"
dir="${dir%/}"
out="$dir/sheets"
mkdir -p "$out"
find "$out" -maxdepth 1 -name '*.png' -delete

sheet() { # size tile geometry per-sheet
  local size="$1" tile="$2" geo="$3" per="$4" i=0 batch=()
  local files
  mapfile -t files < <(cd "$dir" && ls | grep -E "\.${size}(\.s[0-9]+)?\.png$" | sort -V)
  flush() {
    [ ${#batch[@]} -eq 0 ] && return 0
    montage "${batch[@]}" -tile "$tile" -geometry "$geo" -background '#3a3a3a' -fill '#e8e8e8' -pointsize 13 -gravity north "$out/${size}-$(printf %02d "$i").png"
    i=$((i + 1))
    batch=()
  }
  for f in "${files[@]}"; do
    batch+=(-label "${f%.png}" "$dir/$f")
    [ $((${#batch[@]} / 3)) -eq "$per" ] && flush
  done
  flush
  echo "$size: $i sheets (${#files[@]} pictures)"
}

sheet phone 5x1 390x844+6+4 5
sheet laptop 3x2 600x375+6+4 6
sheet wide 2x2 800x450+6+4 4
