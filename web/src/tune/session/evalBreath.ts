import type { EarSessionRec, PacedBreath, SessionPhase } from '@shared/earsession'
import { breathRate, followsPace, stillness } from './breath'

interface BunFile { json(): Promise<unknown> }
interface BunLike { file(path: string): BunFile }
const bun = () => (globalThis as unknown as { Bun: BunLike }).Bun

function loadSession(value: unknown): EarSessionRec {
  if (!value || typeof value !== 'object') throw new Error('session JSON must be an EarSessionRec or {session: EarSessionRec}')
  const raw = value as { session?: EarSessionRec; recording?: EarSessionRec }
  return raw.session ?? raw.recording ?? value as EarSessionRec
}

function pacedStretches(rec: EarSessionRec): Array<{ t0: number; t1: number; perMin: number; breaths: PacedBreath[] }> {
  const breaths = Array.isArray(rec.breaths) ? rec.breaths.filter((b) => b && Number.isFinite(b.t0) && Number.isFinite(b.t1) && b.t1 > b.t0 && b.perMin > 0) : []
  const out: Array<{ t0: number; t1: number; perMin: number; breaths: PacedBreath[] }> = []
  for (const breath of breaths) {
    const prior = out[out.length - 1]
    if (prior && prior.perMin === breath.perMin && breath.t0 - prior.t1 < 1000) {
      prior.t1 = breath.t1; prior.breaths.push(breath)
    } else out.push({ t0: breath.t0, t1: breath.t1, perMin: breath.perMin, breaths: [breath] })
  }
  return out.filter((s) => s.t1 - s.t0 >= 20_000)
}

function freePhases(rec: EarSessionRec, paced: Array<{ t0: number; t1: number }>): SessionPhase[] {
  const phases = Array.isArray(rec.phases) ? rec.phases : []
  return phases.filter((phase) => phase && phase.t1 - phase.t0 >= 20_000 && !paced.some((p) => p.t0 < phase.t1 && phase.t0 < p.t1))
}

function pulsePace(rec: EarSessionRec, t0: number, t1: number): number | null {
  const pulse = Array.isArray(rec.pulse) ? rec.pulse.filter((row) => Array.isArray(row) && row.length >= 4 && row[0]! >= t0 && row[0]! <= t1 && Number.isFinite(row[1]) && Number.isFinite(row[2]) && row[2]! >= 0.5) : []
  if (pulse.length < 20) return null
  // The camera row is already a slow heart-rate series. Reuse the same conservative
  // spectral reader on its bpm column, with quality-gated rows only.
  const rows = pulse.map((row) => [row[0]!, row[1]!, 0, 0, 0, 0, 0, 0, 0, 0])
  return breathRate(rows, t0, t1).perMin
}

function one(rec: EarSessionRec, t0: number, t1: number, asked: number | null): void {
  const read = breathRate(rec.head, t0, t1)
  const lock = asked === null ? null : followsPace(rec.head, t0, t1, asked)
  const blind = read.perMin === null ? 'null' : `${read.perMin.toFixed(1)}/min (conf ${read.conf.toFixed(2)})`
  const paced = asked === null ? '' : ` asked ${asked.toFixed(1)}/min lock ${lock!.follows ? 'follows' : 'no'} coherence ${lock!.coherence.toFixed(2)} amp ${lock!.amplitudeDeg.toFixed(2)}°`
  console.log(`  ${Math.round(t0)}–${Math.round(t1)} ms blind ${blind}${paced}`)
}

async function main(argv: string[]): Promise<void> {
  if (!argv.length) throw new Error('usage: bun web/src/tune/session/evalBreath.ts <session.json> [...]')
  let stretches = 0; let matched = 0; let readable = 0; let errorSum = 0
  for (const path of argv) {
    const rec = loadSession(await bun().file(path).json())
    console.log(`\n== ${path} (${rec.device?.hz ?? '?'} Hz, ${rec.head?.length ?? 0} AirPods rows)`)
    const paced = pacedStretches(rec)
    for (const stretch of paced) {
      stretches++
      const read = breathRate(rec.head, stretch.t0, stretch.t1)
      one(rec, stretch.t0, stretch.t1, stretch.perMin)
      if (read.perMin !== null) { readable++; errorSum += Math.abs(read.perMin - stretch.perMin); if (Math.abs(read.perMin - stretch.perMin) <= 1) matched++ }
    }
    for (const phase of freePhases(rec, paced)) {
      const read = breathRate(rec.head, phase.t0, phase.t1)
      const camera = pulsePace(rec, phase.t0, phase.t1)
      const blind = read.perMin === null ? 'null' : `${read.perMin.toFixed(1)}/min (conf ${read.conf.toFixed(2)})`
      console.log(`  ${phase.name} ${Math.round(phase.t0)}–${Math.round(phase.t1)} ms blind ${blind} camera ${camera === null ? 'null' : `${camera.toFixed(1)}/min`} stillness ${stillness(rec.head, phase.t0, phase.t1)?.toFixed(2) ?? 'null'}°/s`)
    }
    const phaseStill = (rec.phases ?? []).map((phase) => `${phase.name} ${stillness(rec.head, phase.t0, phase.t1)?.toFixed(2) ?? 'null'}°/s`).join(', ')
    console.log(`  stillness per phase: ${phaseStill || 'none'}`)
  }
  const meanError = readable ? errorSum / readable : null
  console.log(`\nsummary: ${matched}/${stretches} paced stretches within 1 breath/min; mean absolute error ${meanError === null ? 'null (no readable stretches)' : `${meanError.toFixed(2)} breath/min over ${readable} readable stretches`}; unreadable ${stretches - readable}`)
}

if ((import.meta as ImportMeta & { main?: boolean }).main) main((globalThis as unknown as { process?: { argv: string[] } }).process?.argv.slice(2) ?? []).catch((error) => { console.error(String(error?.message ?? error)); (globalThis as unknown as { process?: { exitCode?: number } }).process!.exitCode = 1 })
