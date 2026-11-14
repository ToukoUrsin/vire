import type { Channel, EchoComponent, PhaseKey, StepReading } from '@shared/types'

const fmt = (n: number, digits = 1) => {
  if (!Number.isFinite(n)) return '—'
  const p = 10 ** digits
  const v = Math.round(n * p) / p
  return String(v)
}

/** One shared sentence shape for readings on the phone and the big screen. */
export function readingText(c: EchoComponent): string {
  if (c.value == null) return c.note || 'Not read this time.'
  if (c.channel === 'smile' && c.value === 0) return 'No smile seen.'
  if (c.reading) return c.reading
  switch (c.channel as Channel) {
    case 'smile': return `A smile worth ${fmt(c.value)} s of a full smile.`
    case 'voice': return `Moved ${fmt(c.value)} semitones.`
    case 'heart': return `Swung ${Math.round(c.value)} beats a minute with your breath.`
    case 'move': return `${Math.round(c.value)} ${Math.round(c.value) === 1 ? 'degree' : 'degrees'} a second.`
    default: return `${fmt(c.value)} ${c.unit || 'reading'}.`
  }
}

/** The short, shared wording for a finished ping step on the phone and mirror strip. A step that was not read never carries a number. */
export function stepReadingText(key: PhaseKey, r: StepReading | null | undefined, waiting = 'reading'): string {
  if (!r) return waiting
  if (!r.readable || r.value == null) return 'not read'
  // the same rounding as the echo's own figures: whole beats and degrees, one decimal for seconds and semitones
  const whole = String(Math.round(r.value))
  const tenth = fmt(r.value)
  switch (key) {
    case 'settle': return `resting pulse ${whole}`
    case 'nod': return `${whole} ${whole === '1' ? 'degree' : 'degrees'} a second`
    case 'laugh': return `${tenth} s after the laugh`
    case 'speak': return `${tenth} semitones`
    case 'breathe': return `${whole} beats a minute`
  }
}

/** Why a step was not read, in a few words: the phone's own reason without its opening sentence. */
export function stepReadingWhy(r: StepReading | null | undefined): string {
  if (!r || (r.readable && r.value != null)) return ''
  return (r.reason ?? '').replace(/^I couldn[’']t read your \w+ today\.\s*/, '')
}

/** The same reading as a large figure with its unit and one plain line under it: the picture of an echo that has no usual yet. */
export function readingFigure(c: EchoComponent): { n: string; unit: string; sub: string } | null {
  if (c.value == null || !Number.isFinite(c.value)) return null
  const said = c.reading ?? ''
  switch (c.channel as Channel) {
    case 'smile': {
      if (c.value === 0) return { n: 'No smile seen', unit: '', sub: 'the smile stayed at its resting level during the laugh' }
      const start = /starting ([\d.]+) s after/.exec(said)?.[1]
      return { n: fmt(c.value), unit: 's', sub: start ? `of a full smile, from ${start} s after the laugh` : 'of a full smile after the laugh' }
    }
    case 'voice': return { n: fmt(c.value), unit: 'semitones', sub: 'your voice moved as you spoke' }
    case 'heart': {
      const se = /give or take (\d+)/.exec(said)?.[1]
      return { n: String(Math.round(c.value)), unit: 'beats a minute', sub: se ? `your heart swung with your breath, give or take ${se}` : 'your heart swung with your breath' }
    }
    case 'move': return { n: String(Math.round(c.value)), unit: Math.round(c.value) === 1 ? 'degree a second' : 'degrees a second', sub: 'your nod at its quickest' }
    default: return null
  }
}

export function readingLabel(channel: string): string {
  return channel === 'move' ? 'nod' : channel
}

export function heartMissingText(): string {
  return "I couldn't follow your pulse through both breaths. More light on your face, and keep still while you breathe."
}

