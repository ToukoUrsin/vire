import type { EarDay } from './measures'

export interface UsualRow {
  key: 'smiles' | 'smileDeg' | 'nodHz' | 'nodDeg' | 'shakeHz' | 'moveDegS'
  name: string
  unit: string
  today: number | null
  earlier: number[]
  lo: number | null
  hi: number | null
  mid: number | null
  where: 'below' | 'within' | 'above' | 'no usual yet'
  /** smiles only: how many smiles today's minute asked for */
  of?: number
}

const DEFINITIONS: Array<Pick<UsualRow, 'key' | 'name' | 'unit'>> = [
  { key: 'smiles', name: 'Smiles felt', unit: '' },
  { key: 'smileDeg', name: 'Smile size', unit: '°' },
  { key: 'nodHz', name: 'Nod speed', unit: 'a second' },
  { key: 'nodDeg', name: 'Nod size', unit: '°' },
  { key: 'shakeHz', name: 'Shake speed', unit: 'a second' },
  { key: 'moveDegS', name: 'Head movement', unit: '°/s' },
]

const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function rowFor(days: EarDay[], definition: Pick<UsualRow, 'key' | 'name' | 'unit'>): UsualRow {
  const last = days[days.length - 1]
  const today = numberOrNull(last?.[definition.key])
  const earlier = days.slice(0, -1).map((day) => numberOrNull(day?.[definition.key])).filter((value): value is number => value !== null)
  let lo: number | null = null
  let hi: number | null = null
  let mid: number | null = null
  if (earlier.length >= 2) {
    if (earlier.length < 5) {
      // a few minutes only: from the smallest to the largest of them, and a tenth of the middle value more on
      // each side, so two minutes that happened to agree do not make a hair's difference "outside the usual"
      const pad = Math.abs(percentile(earlier, 0.5)) * 0.1
      lo = Math.min(...earlier) - pad
      hi = Math.max(...earlier) + pad
    } else {
      lo = percentile(earlier, 0.1)
      hi = percentile(earlier, 0.9)
    }
    mid = percentile(earlier, 0.5)
  }
  let where: UsualRow['where'] = 'no usual yet'
  if (today !== null && lo !== null && hi !== null) {
    where = today < lo ? 'below' : today > hi ? 'above' : 'within'
  }
  const of = definition.key === 'smiles' && last && Number.isFinite(last.asked) && last.asked > 0 ? { of: last.asked } : {}
  return { ...definition, today, earlier, lo, hi, mid, where, ...of }
}

export function usualRows(days: EarDay[]): UsualRow[] {
  const safeDays = Array.isArray(days) ? days : []
  return DEFINITIONS.map((definition) => rowFor(safeDays, definition))
}
