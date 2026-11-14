// The simulated patients of a clinic re-training run: two teaching minutes each, made by the phone's own script
// (web/src/tune/ear/sim.ts). Each patient is a different script: how big the smile is and how noisy the AirPods are
// vary from patient to patient, so the scores their searches reach differ too. Each file also holds that patient's
// simulated practice history from the named roster person, which the sandbox learns "what works" from. Nobody real is in here.
//   bun sandbox/cohort_minutes.ts <dir> <patients> <seed> <now>     writes <dir>/p1.json ... pN.json, each {"minutes": [...], "practices": [...]}
import { simulateTeach } from '../web/src/tune/ear/sim'
import { generateCohort } from '../server/cohort'

const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function cohortMinutes(seed: number, n: number) {
  const smileSize = 0.12 + 0.88 * rand(seed * 0.001 + n * 1.37)
  const noise = 0.03 + 0.9 * rand(seed * 0.002 + n * 2.71) ** 1.5
  const day = Date.parse('2026-11-14T09:00:00Z')
  return [0, 1].map((k) => simulateTeach({ seed: (seed % 100_000) + n * 31 + k * 7, hz: 50, smileSize, noise, at: new Date(day + n * 3_600_000 + k * 600_000).toISOString() }))
}

if (import.meta.main) {
  const [dir, patients, seed, now] = process.argv.slice(2)
  const n = Number(patients)
  if (!dir || !Number.isInteger(n) || n < 1 || n > 50 || !Number.isFinite(Number(seed)) || !Number.isFinite(Number(now))) {
    console.error('usage: bun sandbox/cohort_minutes.ts <dir> <patients 1..50> <seed> <now>')
    process.exit(2)
  }
  const people = generateCohort(Number(now), Number(seed))
  for (let i = 1; i <= n; i++) {
    const person = people[i - 1]
    if (!person) throw new Error(`roster has no patient ${i}`)
    const practices = person.practices.filter((p) => p.done && p.settle != null).map((p) => ({ kind: p.kind, settle: p.settle!, at: p.at }))
    await Bun.write(`${dir}/p${i}.json`, JSON.stringify({ simulated: true, minutes: cohortMinutes(Number(seed), i), practices }))
  }
}
