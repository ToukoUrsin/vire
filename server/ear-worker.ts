// Pulls teaching-minute jobs from the public server and gives each one a Modal Sandbox of its own.
// Run with: sandbox/run-worker.sh https://the-server   (or VIRE_SERVER=... VIRE_WORKER_TOKEN=... bun server/ear-worker.ts)
//
// The search itself is sandbox/search.py inside the sandbox: a few hundred small models on every minute the
// person has done. This process only passes the minutes in and the board and the model back.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EarJob, EarRecording, EarTried } from '../shared/ear'
import type { CohortClaim, CohortProgress } from '../shared/cohort'

const base = (process.env.VIRE_SERVER ?? '').replace(/\/$/, '')
const token = process.env.VIRE_WORKER_TOKEN ?? ''
const concurrency = Math.max(1, Math.min(4, Number(process.env.VIRE_EAR_CONCURRENCY ?? 2)))
/** a lid on what this worker may spend: each search is a sandbox for under a minute */
const maxRuns = Math.max(1, Number(process.env.VIRE_EAR_MAX_RUNS ?? 60))
const python = process.env.VIRE_PYTHON ?? 'python3'
/** the whole clinic re-trained at once: 40 affordable runs per worker, next to the server's cap */
const maxCohorts = Math.max(0, Number(process.env.VIRE_COHORT_MAX_RUNS ?? 40))
const local = process.env.VIRE_MODAL_LOCAL === '1'
if (import.meta.main && (!base || !token)) throw new Error('VIRE_SERVER and VIRE_WORKER_TOKEN are required')

type Claimed = EarJob & { recording: EarRecording; minutes?: EarRecording[] }
type Line = { tried?: EarTried; result?: { model?: unknown; board?: unknown }; error?: string; sandbox?: string }

const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const post = (path: string, body?: unknown): Promise<Response> =>
  fetch(`${base}${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
const done = (id: string, body: unknown) => post(`/api/ear/jobs/${encodeURIComponent(id)}/done`, body)

async function claim(): Promise<Claimed | null> {
  const res = await post('/api/ear/jobs/claim')
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`claim failed (${res.status})`)
  return (await res.json()) as Claimed
}

let runs = 0

async function run(job: Claimed): Promise<void> {
  if (++runs > maxRuns) {
    await done(job.id, { error: 'this worker has done all the searches it may; the model made on the device stays' })
    return
  }
  const board: EarTried[] = []
  const started = Date.now()
  const minutes = job.minutes?.length ? job.minutes : [job.recording]
  console.log(`[ear-worker] ${job.id}: ${minutes.length} minute(s)`)
  // the board goes up at most once a second, and at least every ten seconds so the server knows the search is alive
  let sent = 0
  let sentAt = 0
  let busy = false
  const tell = async (force = false) => {
    if (busy || (!force && (board.length === sent || Date.now() - sentAt < 1000))) return
    busy = true
    sent = board.length
    sentAt = Date.now()
    await post(`/api/ear/jobs/${encodeURIComponent(job.id)}/progress`, { tried: board, seconds: (Date.now() - started) / 1000 }).catch(() => {})
    busy = false
  }
  const beat = setInterval(() => void tell(Date.now() - sentAt > 10_000), 1000)
  const proc = Bun.spawn([python, 'sandbox/modal_runner.py'], {
    cwd: process.env.VIRE_REPO ?? process.cwd(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  proc.stdin.write(JSON.stringify({ minutes }))
  proc.stdin.end()
  let result: { model?: unknown; board?: unknown } | null = null
  let error = ''
  const take = (line: string) => {
    if (!line.trim()) return
    let m: Line
    try {
      m = JSON.parse(line) as Line
    } catch {
      return
    }
    if (m.sandbox) console.log(`[ear-worker] ${job.id}: sandbox ${m.sandbox}`)
    if (m.tried && typeof m.tried.name === 'string' && Number.isFinite(m.tried.auc) && Number.isFinite(m.tried.ms)) {
      board.push({ name: m.tried.name.slice(0, 180), auc: Math.max(0, Math.min(1, m.tried.auc)), ms: Math.max(0, Math.min(600_000, m.tried.ms)) })
    }
    if (m.result) result = m.result
    if (m.error) error = m.error
  }
  try {
    let pending = ''
    const text = new TextDecoder()
    for await (const chunk of proc.stdout) {
      pending += text.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      lines.forEach(take)
    }
    take(pending)
  } finally {
    clearInterval(beat)
  }
  const exit = await proc.exited
  if (exit !== 0 && !error) error = `the sandbox runner ended with ${exit}`
  const found = result as { model?: unknown; board?: unknown } | null
  if (found?.model && found.board) {
    await tell(true)
    const res = await done(job.id, { model: found.model, board: found.board })
    if (!res.ok) await done(job.id, { error: `the server did not take the model (${res.status})` })
    console.log(`[ear-worker] ${job.id}: ${res.ok ? 'done' : 'refused'}, ${board.length} tried in ${Math.round((Date.now() - started) / 100) / 10} s`)
  } else {
    await done(job.id, { error: error || 'the sandbox returned no model' })
    console.log(`[ear-worker] ${job.id}: failed: ${error}`)
  }
}

// ---- the whole clinic at once: simulated patients, one sandbox each ----

let cohorts = 0

async function cohortRun(claim: CohortClaim): Promise<void> {
  const id = encodeURIComponent(claim.id)
  const where = local ? 'local' : 'modal'
  const waiting = (): CohortProgress => ({ patients: Array.from({ length: claim.patients }, (_, i) => ({ n: i + 1, state: 'waiting', tried: 0, seconds: 0, auc: null })), seconds: 0, sandboxes: 0, peak: 0, where })
  if (++cohorts > maxCohorts) {
    await post(`/api/ear/cohort/${id}/done`, { ...waiting(), error: 'this worker has done all the re-training runs it may' })
    return
  }
  const started = Date.now()
  await post(`/api/ear/cohort/${id}/progress`, waiting()).catch(() => {})
  const dir = mkdtempSync(join(tmpdir(), 'vire-cohort-'))
  // set from the runner's lines (inside a callback): spelled with `as` so the checker does not narrow them to the start value
  let last = null as CohortProgress | null
  let end = {} as { done?: CohortProgress; error?: string }
  try {
    // two simulated minutes and a simulated practice history per patient, each patient a different script (sandbox/cohort_minutes.ts)
    const made = Bun.spawn(['bun', 'sandbox/cohort_minutes.ts', dir, String(claim.patients), String(claim.seed), String(claim.now)], { cwd: process.env.VIRE_REPO ?? process.cwd(), stdout: 'ignore', stderr: 'pipe' })
    if ((await made.exited) !== 0) throw new Error(`could not make the simulated minutes: ${(await new Response(made.stderr).text()).slice(0, 200)}`)
    console.log(`[ear-worker] cohort ${claim.id}: ${claim.patients} simulated patients, ${where}, minutes made in ${Date.now() - started} ms`)
    const proc = Bun.spawn([python, 'sandbox/cohort_runner.py'], {
      cwd: process.env.VIRE_REPO ?? process.cwd(),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    proc.stdin.write(JSON.stringify({ dir, patients: claim.patients }))
    proc.stdin.end()
    let busy = false
    const take = (line: string) => {
      if (!line.trim()) return
      let m: { cohort?: CohortProgress; done?: CohortProgress; error?: string; note?: unknown }
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      if (m.note) console.log(`[ear-worker] cohort ${claim.id}: ${JSON.stringify(m.note).slice(0, 400)}`)
      if (m.cohort) last = m.cohort
      if (m.done) end = { done: m.done }
      if (m.error) end = { error: m.error }
      if (m.cohort && !busy) {
        busy = true
        void post(`/api/ear/cohort/${id}/progress`, m.cohort).catch(() => {}).finally(() => (busy = false))
      }
    }
    let pending = ''
    const text = new TextDecoder()
    for await (const chunk of proc.stdout) {
      pending += text.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      lines.forEach(take)
    }
    take(pending)
    const exit = await proc.exited
    if (!end.done && !end.error) end = { error: `the cohort runner ended with ${exit}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const final = end.done ?? last ?? waiting()
  const res = await post(`/api/ear/cohort/${id}/done`, end.done ? final : { ...final, error: end.error ?? 'the run failed' })
  const done = final.patients.filter((p) => p.state === 'done')
  const aucs = done.map((p) => p.auc ?? 0)
  const said = (w: string) => final.patients.filter((p) => p.works?.said === w).length
  console.log(
    `[ear-worker] cohort ${claim.id}: ${end.done ? 'done' : `failed (${end.error})`}${res.ok ? '' : ` (server said ${res.status})`}, ` +
      `${done.length}/${claim.patients} patients in ${final.seconds} s, peak ${final.peak} sandboxes at once, ` +
      `${final.patients.reduce((s, p) => s + p.tried, 0)} models tried, held-out ${aucs.length ? `${Math.min(...aucs).toFixed(3)}..${Math.max(...aucs).toFixed(3)}` : '-'}, ` +
      `what works: ${said('learned')} learned, ${said('leaning')} leaning, ${said('early')} too early, ${final.refused ?? 0} refusals`,
  )
}

/** a server without cohort runs (an older build) answers 404: ask again in a minute */
let cohortQuietUntil = 0
async function claimCohort(): Promise<CohortClaim | null> {
  if (Date.now() < cohortQuietUntil || cohorts >= maxCohorts) return null
  const res = await post('/api/ear/cohort/claim')
  if (res.status === 204) return null
  if (!res.ok) {
    cohortQuietUntil = Date.now() + 60_000
    return null
  }
  return (await res.json()) as CohortClaim
}

async function main(): Promise<void> {
  const active = new Set<Promise<void>>()
  let cohort: Promise<void> | null = null
  console.log(`[ear-worker] ${base} concurrency=${concurrency} at most ${maxRuns} searches, ${maxCohorts} clinic runs${local ? ', on this machine (VIRE_MODAL_LOCAL=1)' : ''}`)
  for (;;) {
    try {
      // a person's own minute always goes first; the clinic's run then goes beside it, never in its way
      while (active.size < concurrency) {
        const job = await claim()
        if (!job) break
        const task: Promise<void> = run(job)
          .catch(async (err) => {
            await done(job.id, { error: err instanceof Error ? err.message.slice(0, 300) : 'worker failed' }).catch(() => {})
          })
          .finally(() => active.delete(task))
        active.add(task)
      }
      if (!cohort) {
        const claimed = await claimCohort()
        if (claimed) {
          cohort = cohortRun(claimed)
            .catch(async (err) => {
              console.log(`[ear-worker] cohort ${claimed.id}: ${err instanceof Error ? err.message : err}`)
              await post(`/api/ear/cohort/${encodeURIComponent(claimed.id)}/done`, { error: err instanceof Error ? err.message.slice(0, 300) : 'worker failed' }).catch(() => {})
            })
            .finally(() => (cohort = null))
        }
      }
    } catch (err) {
      // the server is restarting or the network blinked: keep asking
      console.log(`[ear-worker] ${err instanceof Error ? err.message : err}`)
      await Bun.sleep(3000)
    }
    if (!active.size) await Bun.sleep(700)
    else await Promise.race([...active, Bun.sleep(700)])
  }
}

if (import.meta.main) await main()
