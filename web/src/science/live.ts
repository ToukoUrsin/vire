// The two live sources of the evidence page, read defensively: every field is optional, either file may be
// missing, and neither shape is trusted. Anything that is not a finite number or a non-empty string becomes null,
// so the page can only ever show a value or an intended "running" state.
import { CHANNELS } from '@shared/types'
import type { Channel } from '@shared/types'
import { api } from '../shared/api'

type Bag = Record<string, unknown>

const bag = (v: unknown): Bag | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// ---------- validation.json (VALIDATE writes it) ----------

export interface PulseCheck {
  dataset: string | null
  url: string | null
  subjects: number | null
  minutes: number | null
  maeBpm: number | null
  rmseBpm: number | null
  within5Pct: number | null
  coveragePct: number | null
  reference: string | null
  note: string | null
}
export interface SmileCheck {
  clips: number | null
  people: number | null
  sensitivityPct: number | null
  falsePositivePct: number | null
  faceFoundPct: number | null
  source: string | null
  note: string | null
}
/** the heart swing at the breath's period against the oximeter (validation/swing_validation.ts) */
export interface SwingCheck {
  people: number | null
  windowsReferenceClean: number | null
  windowsShown: number | null
  shownPct: number | null
  maeBpm: number | null
  correlation: number | null
  meanReferenceBpm: number | null
  oldMaeBpm: number | null
  stillWindows: number | null
  stillFalse: number | null
  stillFalseOld: number | null
  /** what the lock-in reads for a simulated heart at 80 that swings by 12 */
  known12Bpm: number | null
}
export interface RobustRow {
  condition: string
  faceFoundPct: number | null
  pulseCoveragePct: number | null
  smileSensitivityPct: number | null
}
export interface Validation {
  generatedAt: string | null
  pulse: PulseCheck | null
  swing: SwingCheck | null
  smile: SmileCheck | null
  robustness: RobustRow[]
  limits: string[]
}

// a percentage outside 0..100 is a broken reading, not a full bar: show it as missing
const pct = (v: unknown): number | null => {
  const n = num(v)
  return n === null || n < 0 || n > 100 ? null : n
}
const pos = (v: unknown): number | null => {
  const n = num(v)
  return n === null || n < 0 ? null : n
}
const httpUrl = (v: unknown): string | null => {
  const s = str(v)
  return s !== null && /^https?:\/\//i.test(s) ? s : null
}

export function parseValidation(raw: unknown): Validation | null {
  const root = bag(raw)
  if (!root) return null
  const p = bag(root.pulse)
  const s = bag(root.smile)
  const pulse: PulseCheck | null = p && {
    dataset: str(p.dataset),
    url: httpUrl(p.url),
    subjects: pos(p.subjects),
    minutes: pos(p.minutes),
    maeBpm: pos(p.maeBpm),
    rmseBpm: pos(p.rmseBpm),
    within5Pct: pct(p.within5Pct),
    coveragePct: pct(p.coveragePct),
    reference: str(p.reference),
    note: str(p.note),
  }
  const smile: SmileCheck | null = s && {
    clips: pos(s.clips),
    people: pos(s.people),
    sensitivityPct: pct(s.sensitivityPct),
    falsePositivePct: pct(s.falsePositivePct),
    faceFoundPct: pct(s.faceFoundPct),
    source: str(s.source),
    note: str(s.note),
  }
  const h = bag(root.heartSwing)
  const still = bag(h?.still)
  const known = list(bag(h?.knownSwing)?.results)
    .map(bag)
    .find((r) => r !== null && r.bpm === 80 && r.swing === 12)
  const swing: SwingCheck | null = h && {
    people: pos(h.people),
    windowsReferenceClean: pos(h.windowsReferenceClean),
    windowsShown: pos(h.windowsShown),
    shownPct: pct(h.shownPct),
    maeBpm: pos(h.maeBpm),
    correlation: num(h.correlation),
    meanReferenceBpm: pos(h.meanReferenceBpm),
    oldMaeBpm: pos(h.oldMaeBpm),
    stillWindows: pos(still?.windows),
    stillFalse: pos(still?.newFalse),
    stillFalseOld: pos(still?.oldFalse),
    known12Bpm: pos(known?.meanReading),
  }
  const robustness: RobustRow[] = []
  for (const r of list(root.robustness)) {
    const b = bag(r)
    const condition = b && str(b.condition)
    if (!b || !condition) continue
    robustness.push({
      condition,
      faceFoundPct: pct(b.faceFoundPct),
      pulseCoveragePct: pct(b.pulseCoveragePct),
      smileSensitivityPct: pct(b.smileSensitivityPct),
    })
  }
  const limits = list(root.limits)
    .map(str)
    .filter((x): x is string => x !== null)
  const hasPulse = pulse !== null && Object.values(pulse).some((v) => v !== null)
  const hasSmile = smile !== null && Object.values(smile).some((v) => v !== null)
  if (!hasPulse && !hasSmile && robustness.length === 0 && limits.length === 0) return null
  const hasSwing = swing !== null && swing.maeBpm !== null
  return { generatedAt: str(root.generatedAt), pulse: hasPulse ? pulse : null, swing: hasSwing ? swing : null, smile: hasSmile ? smile : null, robustness, limits }
}

/** null when the file is missing, is not JSON (a dev server answers with index.html) or holds nothing usable. */
export async function loadValidation(): Promise<Validation | null> {
  try {
    const res = await fetch(new URL('validation.json', document.baseURI), { cache: 'no-store' })
    if (!res.ok) return null
    return parseValidation(JSON.parse(await res.text()))
  } catch {
    return null
  }
}

// ---------- detect.json (VALIDATE writes; optional in a dev build) ----------

export interface DetectFlagSummary {
  within7Pct: number
  within14Pct: number
  within28Pct: number
  medianDays: number | null
  q1Days: number | null
  q3Days: number | null
  flaggedPeople: number
}
export interface DetectQuestionnaire {
  threshold: number
  falseEpisodesPerPersonYear: number
  falseEverFlagged12WeeksPct: number
  medianDays: number | null
  q1Days: number | null
  q3Days: number | null
  flaggedPeople: number
}
export interface DetectChartRow {
  delta: number
  vire: DetectFlagSummary
  questionnaire: DetectQuestionnaire
}
export interface DetectData {
  generatedAt: string | null
  gitCommit: string | null
  peoplePerCell: number | null
  chart: {
    adherence: number
    wobble: boolean
    slideChannels: string
    falseFlags: { episodesPerPersonYear: number; everFlagged12WeeksPct: number }
    rows: DetectChartRow[]
  } | null
}

const flagSummary = (v: unknown): DetectFlagSummary | null => {
  const b = bag(v)
  if (!b) return null
  const n = (key: string) => num(b[key])
  const nonNegative = (key: string) => {
    const x = n(key)
    return x === null || x < 0 ? null : x
  }
  const within7Pct = nonNegative('within7Pct')
  const within14Pct = nonNegative('within14Pct')
  const within28Pct = nonNegative('within28Pct')
  const flaggedPeople = nonNegative('flaggedPeople')
  if (within7Pct === null || within14Pct === null || within28Pct === null || flaggedPeople === null) return null
  return { within7Pct, within14Pct, within28Pct, medianDays: nonNegative('medianDays'), q1Days: nonNegative('q1Days'), q3Days: nonNegative('q3Days'), flaggedPeople }
}

const questionnaire = (v: unknown): DetectQuestionnaire | null => {
  const b = bag(v)
  if (!b) return null
  const threshold = num(b.threshold)
  const falseEpisodesPerPersonYear = num(b.falseEpisodesPerPersonYear)
  const falseEverFlagged12WeeksPct = pct(b.falseEverFlagged12WeeksPct)
  const medianDays = num(b.medianDays)
  const q1Days = num(b.q1Days)
  const q3Days = num(b.q3Days)
  const flaggedPeople = num(b.flaggedPeople)
  if (threshold === null || falseEpisodesPerPersonYear === null || falseEverFlagged12WeeksPct === null || flaggedPeople === null) return null
  return { threshold, falseEpisodesPerPersonYear, falseEverFlagged12WeeksPct, medianDays, q1Days, q3Days, flaggedPeople }
}

export function parseDetect(raw: unknown): DetectData | null {
  const root = bag(raw)
  const c = root && bag(root.chart)
  if (!root || !c) return null
  const adherence = num(c.adherence)
  const wobble = c.wobble === true
  const slideChannels = str(c.slideChannels)
  const f = bag(c.falseFlags)
  const episodesPerPersonYear = f && num(f.episodesPerPersonYear)
  const everFlagged12WeeksPct = f && pct(f.everFlagged12WeeksPct)
  if (adherence === null || slideChannels === null || episodesPerPersonYear === null || everFlagged12WeeksPct === null) return null
  const rows: DetectChartRow[] = []
  for (const rawRow of list(c.rows)) {
    const b = bag(rawRow)
    const delta = b && num(b.delta)
    const vire = b && flagSummary(b.vire)
    const q = b && questionnaire(b.questionnaire)
    if (delta === null || !vire || !q) continue
    rows.push({ delta, vire, questionnaire: q })
  }
  if (!rows.length) return null
  return {
    generatedAt: str(root.generatedAt),
    gitCommit: str(root.gitCommit),
    peoplePerCell: pos(root.peoplePerCell),
    chart: { adherence, wobble, slideChannels, falseFlags: { episodesPerPersonYear, everFlagged12WeeksPct }, rows },
  }
}

export async function loadDetect(): Promise<DetectData | null> {
  try {
    const res = await fetch(new URL('detect.json', document.baseURI), { cache: 'no-store' })
    if (!res.ok) return null
    return parseDetect(JSON.parse(await res.text()))
  } catch {
    return null
  }
}

// ---------- GET /api/wall (WALL serves it) ----------

export type Rates = Record<Channel, number | null>

export interface Hall {
  simulated: boolean
  visitors: number | null
  pings: number | null
  returning: number | null
  minGapH: number | null
  generatedAt: string | null
  /** share of pings where the phone could read the channel, 0..1 */
  rates: Rates
  devices: { label: string; pings: number | null; rates: Rates }[]
  /** per channel: how far the reading moved between a returning visitor's first and last ping, in the channel's unit */
  change: Record<Channel, Change | null>
}
export interface Change {
  n: number
  median: number
  q1: number | null
  q3: number | null
  unit: string | null
}

const rate = (v: unknown): number | null => {
  const n = num(v)
  if (n === null || n < 0) return null
  // the contract says 0..1; anything above that is taken as a percentage, and anything above 100 as broken
  if (n > 100) return null
  return n > 1 ? n / 100 : n
}
const rates = (v: unknown): Rates => {
  const b = bag(v) ?? {}
  return { smile: rate(b.smile), voice: rate(b.voice), heart: rate(b.heart), move: rate(b.move) }
}

export function parseHall(raw: unknown): Hall | null {
  const root = bag(raw)
  if (!root) return null
  const r = rates(root.readRates)
  const change: Hall['change'] = { smile: null, voice: null, heart: null, move: null }
  for (const c of list(root.channels)) {
    const b = bag(c)
    const ch = b && str(b.channel)
    if (!b || !ch || !(CHANNELS as string[]).includes(ch)) continue
    // older shape: the rate sits on each entry of `channels`
    if (r[ch as Channel] === null) r[ch as Channel] = rate(b.readRate)
    const d = bag(b.change)
    const n = d && pos(d.n)
    const median = d && num(d.median)
    if (d && n !== null && n >= 1 && median !== null) change[ch as Channel] = { n, median, q1: num(d.q1), q3: num(d.q3), unit: str(b.unit) }
  }
  const devices: Hall['devices'] = []
  for (const d of list(root.devices)) {
    const b = bag(d)
    const label = b && (str(b.label) ?? str(b.family))
    if (!b || !label) continue
    devices.push({ label, pings: pos(b.pings), rates: rates(b.readRates) })
  }
  const hall: Hall = {
    simulated: root.simulated === true,
    visitors: pos(root.visitors),
    pings: pos(root.pings),
    returning: pos(root.returning),
    minGapH: pos(root.minGapH),
    generatedAt: str(root.generatedAt),
    rates: r,
    devices,
    change,
  }
  const known = hall.visitors !== null || hall.pings !== null || CHANNELS.some((c) => hall.rates[c] !== null)
  return known ? hall : null
}

/** null when the endpoint is not there yet (404), errors, or answers with a shape we cannot read. */
export async function loadHall(): Promise<Hall | null> {
  try {
    return parseHall(await api<unknown>('wall'))
  } catch {
    return null
  }
}
