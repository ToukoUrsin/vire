#!/usr/bin/env bun
// Replays the skin colour series captured in a browser run (run_lab.mjs) through the shipped pulse code
// (web/src/sense/rppg.ts), outside the browser. Same class, same numbers in, so it is a fast way to try a
// change on every subject before confirming it with real browser runs. Not a source of reported results.
//
//   bun validation/replay_pulse.ts <raw_dir> <out_dir>
//
// Writes run_lab-shaped files (same face rows, recomputed pulse rows) that score_pulse.py can score.
// The motion gate is taken as recorded (it depends on pose, not on the pulse code).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CameraPulse } from '../web/src/sense/rppg'
import { HEART_MIN_QUALITY } from '../web/src/sense/features'

const [rawDir, outDir] = process.argv.slice(2)
if (!rawDir || !outDir) throw new Error('usage: replay_pulse.ts <raw_dir> <out_dir>')
mkdirSync(outDir, { recursive: true })
for (const name of readdirSync(rawDir).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(path.join(rawDir, name), 'utf8'))
  const pulse = new CameraPulse()
  const rows: (number | null)[][] = []
  for (const f of d.face) {
    const [t, , , present, , , , , , , , gate, , r, g, b] = f
    if (present && r !== null) {
      const st = pulse.push(t, r, g, b)
      const quality = st.snrQuality * gate
      rows.push([t, quality >= HEART_MIN_QUALITY ? st.bpm : null, Math.round(quality * 1000) / 1000, st.wave, st.snrDb, st.bpm])
    } else rows.push([t, null, 0, 0, null, null])
  }
  d.pulse = rows
  d.pulseCols = ['t', 'bpm', 'quality', 'wave', 'snrDb', 'rawBpm']
  writeFileSync(path.join(outDir, name), JSON.stringify(d))
}
console.log('replayed', rawDir, '->', outDir)
