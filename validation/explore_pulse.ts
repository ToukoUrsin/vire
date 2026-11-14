#!/usr/bin/env bun
// Parameter exploration for the camera pulse: a copy of the estimator in web/src/sense/rppg.ts with its constants
// as options, replayed over the skin colour series of browser runs. Used to choose a fix; the fix itself goes into
// rppg.ts and is then confirmed with replay_pulse.ts and real browser runs.
//
//   bun validation/explore_pulse.ts <raw_dir> <out_dir> [gapResetMs=400] [windowS=10] [minS=6]
//
// Output rows: t, bpm (always the spectral peak, never withheld), quality (snr * recorded gate), wave(0), snrDb, bpm.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PosStream, spectralPeak, snrToQuality } from '../web/src/sense/dsp'

const [rawDir, outDir, gapArg, winArg, minArg] = process.argv.slice(2)
const GAP = Number(gapArg ?? 400)
const WIN = Number(winArg ?? 10)
const MIN = Number(minArg ?? 6)
const FS = 30
const DT = 1000 / FS
mkdirSync(outDir, { recursive: true })

class Pulse {
  pos = new PosStream(FS)
  have = false
  pt = 0
  pr = 0
  pg = 0
  pb = 0
  nextT = 0
  out: number[] = []
  since = 0
  bpm: number | null = null
  snr: number | null = null
  resets = 0
  push(t: number, r: number, g: number, b: number): void {
    if (this.have && t <= this.pt) return
    if (this.have && t - this.pt > GAP) {
      this.pos.reset()
      this.have = false
      this.out = []
      this.bpm = null
      this.snr = null
      this.resets++
    }
    if (!this.have) {
      this.have = true
      this.pt = t
      this.pr = r
      this.pg = g
      this.pb = b
      this.nextT = t
      return
    }
    while (this.nextT <= t) {
      const u = (this.nextT - this.pt) / (t - this.pt)
      const y = this.pos.push(this.pr + (r - this.pr) * u, this.pg + (g - this.pg) * u, this.pb + (b - this.pb) * u)
      this.nextT += DT
      if (y === null) continue
      this.out.push(y)
      if (++this.since >= 10) {
        this.since = 0
        if (this.out.length >= MIN * FS) {
          const pk = spectralPeak(this.out.slice(-WIN * FS), FS, 0.7, 3.0)
          this.bpm = pk ? pk.freq * 60 : null
          this.snr = pk ? pk.snrDb : null
        } else {
          this.bpm = null
          this.snr = null
        }
      }
    }
    this.pt = t
    this.pr = r
    this.pg = g
    this.pb = b
  }
}

for (const name of readdirSync(rawDir).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(path.join(rawDir, name), 'utf8'))
  const p = new Pulse()
  const rows: (number | null)[][] = []
  for (const f of d.face) {
    const [t, , , present, , , , , , , , gate, , r, g, b] = f
    if (present && r !== null) {
      p.push(t, r, g, b)
      const q = p.snr === null ? 0 : snrToQuality(p.snr) * gate
      rows.push([t, p.bpm, Math.round(q * 1000) / 1000, 0, p.snr, p.bpm])
    } else rows.push([t, null, 0, 0, null, null])
  }
  d.pulse = rows
  d.resets = p.resets
  writeFileSync(path.join(outDir, name), JSON.stringify(d))
}
