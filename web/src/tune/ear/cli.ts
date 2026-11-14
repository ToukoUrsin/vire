// Command line for the ear model, run with bun. The sandbox uses `dump`, `curve` and `finish` around its search.
import { learningCurve, searchEarModel, trainEarModel } from './index'
import { dumpMinutes, finishSearch, type Picked } from './sandbox'
import type { Candidate } from './check'
import type { EarModel2, EarRecording } from '@shared/ear'

interface BunLike { file(path: string): { json(): Promise<unknown> }; write(path: string, data: string | Uint8Array): Promise<number> }
const bun = () => (globalThis as unknown as { Bun: BunLike }).Bun
const USAGE = `usage: bun web/src/tune/ear/cli.ts
  train <minute.json> [more minutes of the same person ...]
  search <minute.json> <out.json> [--max N] [--ms N] [--with <minute.json> ...]
  dump <minutes.json> <dir>                       what the sandbox search reads
  curve <minutes.json> <out.json>                 what each minute added
  finish <minutes.json> <picked.json> <out.json> [--curve <curve.json>]`

async function readRecording(path: string): Promise<EarRecording> {
  const raw = await bun().file(path).json() as { recording?: EarRecording } | EarRecording
  return 'recording' in raw && raw.recording ? raw.recording : raw as EarRecording
}

async function readMinutes(path: string): Promise<EarRecording[]> {
  const raw = await bun().file(path).json() as { minutes?: EarRecording[]; recording?: EarRecording } | EarRecording
  if ('minutes' in raw && Array.isArray(raw.minutes)) return raw.minutes
  if ('recording' in raw && raw.recording) return [raw.recording]
  return [raw as EarRecording]
}

async function main(argv: string[]): Promise<void> {
  const mode = argv[0]; const input = argv[1]
  if (!mode || !input || !['train', 'search', 'dump', 'curve', 'finish'].includes(mode)) throw new Error(USAGE)
  const recs = await readMinutes(input)
  if (mode === 'train') { const more = await Promise.all(argv.slice(2).map(readRecording)); console.log(JSON.stringify(trainEarModel([...recs, ...more]))); return }
  if (mode === 'dump') {
    const dir = argv[2]; if (!dir) throw new Error(USAGE)
    const { meta, files } = dumpMinutes(recs)
    for (const f of files) await bun().write(`${dir}/${f.name}`, new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength))
    await bun().write(`${dir}/meta.json`, JSON.stringify(meta))
    return
  }
  if (mode === 'curve') {
    const output = argv[2]; if (!output) throw new Error(USAGE)
    await bun().write(output, JSON.stringify(learningCurve(recs)))
    return
  }
  if (mode === 'finish') {
    const picked = argv[2]; const output = argv[3]; if (!picked || !output) throw new Error(USAGE)
    let curve: EarModel2['curve']
    const at = argv.indexOf('--curve')
    if (at > 0) { try { curve = await bun().file(argv[at + 1]).json() as EarModel2['curve'] } catch { /* the curve is extra: the model goes back without it */ } }
    const done = finishSearch(recs, await bun().file(picked).json() as Picked, curve)
    await bun().write(output, JSON.stringify(done))
    return
  }
  const output = argv[2]; if (!output) throw new Error('search needs <out.json>')
  let max: number | undefined; let ms: number | undefined; const more: EarRecording[] = []; let extraCandidates: Candidate[] = []
  for (let i = 3; i < argv.length; i++) { if (argv[i] === '--max') max = Number(argv[++i]); else if (argv[i] === '--ms') ms = Number(argv[++i]); else if (argv[i] === '--with') more.push(await readRecording(argv[++i])); else if (argv[i] === '--candidates') { const value = await bun().file(argv[++i]).json(); extraCandidates = Array.isArray(value) ? value as Candidate[] : [] } }
  const result = searchEarModel([...recs, ...more], { maxCandidates: max, budgetMs: ms, extraCandidates, onTried: t => console.log(JSON.stringify({ tried: t })) })
  await bun().write(output, JSON.stringify({ model: result.model, board: result.board }))
}

if ((import.meta as ImportMeta & { main?: boolean }).main) main((globalThis as unknown as { process?: { argv: string[] } }).process?.argv.slice(2) ?? []).catch(err => { console.error(String(err?.message ?? err)); (globalThis as unknown as { process?: { exitCode?: number } }).process!.exitCode = 1 })
