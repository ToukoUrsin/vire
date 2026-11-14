#!/usr/bin/env bash
# judging/packet.sh N VIDEO: assemble the cold packet for round N (only what a judge would be shown).
set -euo pipefail
n="${1:?round}"; video="${2:?demo video path}"
root="$(cd "$(dirname "$0")/.." && pwd)"
d="/bulk2/runs/depression/judging/round-${n}"
mkdir -p "${d}/packet"
cp "${root}/judging/brief.md" "${d}/packet/brief.md"
# the submission as it would be pasted: everything up to the lead's own notes
python3 - "$root/pitch/submission.md" "${d}/packet/submission.md" <<'PY'
import sys,re
s=open(sys.argv[1]).read()
cut=s.find('## (stop pasting here)')
if cut>0: s=s[:cut]
s=re.sub(r'^Limits:.*\n','',s,flags=re.M)
# the hall count is filled from the live wall, and the line is dropped while fewer than ten people have pinged
import json,urllib.request
try: n=int(json.load(urllib.request.urlopen('http://127.0.0.1:8871/api/wall',timeout=5)).get('visitors',0))
except Exception: n=0
s=re.sub(r'^- \*\*\[SUNDAY: people\]\*\*.*\n', f'- **{n}** people at Junction have pinged in a loud hall.\n' if n>=10 else '', s, flags=re.M)
assert '[SUNDAY' not in s, 'a SUNDAY slot is still in the pasted text'
open(sys.argv[2],'w').write(s.strip()+'\n')
PY
cp "$video" "${d}/packet/demo.mp4"
cp "${root}/judging/links.md" "${d}/packet/links.md"
echo "${d}"
