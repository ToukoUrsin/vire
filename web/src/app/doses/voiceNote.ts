// Reach out: how much the voice moved in the note, read the way the echo reads the ping's spoken sentence.
// Pure, so it runs in tests.
import { voiceFeatures } from '../../sense/features'
import type { VoiceFrame } from '../../sense/types'
import { mean, median } from './num'

export const NOTE_SECONDS = 10

/** pitch variation in semitones (the echo's voice number), or null when too little voiced speech was heard */
export function pitchSpread(frames: VoiceFrame[]): number | null {
  if (frames.length < 10) return null
  const t = frames.map((f) => f.t)
  const features = voiceFeatures(
    t,
    frames.map((f) => f.rms),
    frames.map((f) => f.voiced),
    frames.map((f) => f.f0),
    [t[0]!, t[t.length - 1]! + 1],
  )
  return features.f0SdSemitones
}

/**
 * The same number for today's ping, from the pitch trace the phone kept of its spoken sentence
 * (ten points a second). Null with fewer than ten pitched points, like the ping's own reading.
 */
export function pingSpread(f0: (number | null)[]): number | null {
  const pitched = f0.filter((f): f is number => f != null && f > 0)
  if (pitched.length < 10) return null
  const mid = median(pitched)
  const semitones = pitched.map((f) => 12 * Math.log2(f / mid))
  const mean = semitones.reduce((a, b) => a + b, 0) / semitones.length
  return Math.sqrt(semitones.reduce((a, st) => a + (st - mean) ** 2, 0) / semitones.length)
}

/** a pitch this far from the note's middle is the tracker landing on the wrong octave, not the voice */
const OCTAVE_SLIP_ST = 9
/** the line runs on through a pause this short (a consonant), and breaks at a longer one */
const JOIN_MS = 220

/**
 * The pitch of the note for drawing: semitones around its own middle, one value per frame, null where there is
 * no voice. Each value is eased over its neighbours, so the line shows the melody and not the tracker's jitter.
 */
export function pitchLine(frames: VoiceFrame[]): (number | null)[] {
  const pitched = frames.map((f) => f.f0).filter((f): f is number => f != null)
  if (!pitched.length) return frames.map(() => null)
  const mid = median(pitched)
  const raw = frames.map((f) => {
    if (!f.voiced || f.f0 == null) return null
    const st = 12 * Math.log2(f.f0 / mid)
    return Math.abs(st) > OCTAVE_SLIP_ST ? null : st
  })
  return joined(frames, eased(eased(raw, 3, median), 2, mean))
}

/** each value replaced by `of` its neighbours up to `reach` frames each way; the gaps stay gaps */
function eased(st: (number | null)[], reach: number, of: (xs: number[]) => number): (number | null)[] {
  return st.map((x, i) => {
    if (x == null) return null
    return of(st.slice(Math.max(0, i - reach), i + reach + 1).filter((y): y is number => y != null))
  })
}

/** short pauses filled with a straight line between the pitch before and the pitch after */
function joined(frames: VoiceFrame[], st: (number | null)[]): (number | null)[] {
  const out = [...st]
  let last = -1
  for (let i = 0; i < st.length; i++) {
    if (st[i] == null) continue
    if (last >= 0 && i - last > 1 && frames[i]!.t - frames[last]!.t <= JOIN_MS) {
      for (let k = last + 1; k < i; k++) out[k] = st[last]! + ((st[i]! - st[last]!) * (k - last)) / (i - last)
    }
    last = i
  }
  return out
}

/** how the note compares with today's ping, in words; a third of a semitone either way is the same */
export function againstPing(note: number, ping: number): string {
  const d = note - ping
  if (Math.abs(d) < 0.3) return 'about the same as in your ping'
  const size = Math.abs(d) < 1 ? 'a touch ' : ''
  return `${size}${d > 0 ? 'more' : 'less'} than in your ping`
}

export function reachEndLine(recorded: boolean, spread: number | null, ping: number | null): string {
  if (!recorded) return 'No voice note today, so nothing was read.'
  if (spread == null) return 'I heard the note, but too little of your voice to read its pitch.'
  const moved = `Your voice moved ${spread.toFixed(1)} semitones`
  return ping == null ? `${moved}.` : `${moved}, ${againstPing(spread, ping)}.`
}
