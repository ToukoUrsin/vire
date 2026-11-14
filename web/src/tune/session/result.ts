// What the Today result screen says about one practice, in its own words: the verdict and the rows for the heart,
// stillness and breathing. Shared with the replay (#/watch), so a played-back run says exactly what Today said.
import type { SessionRead } from '@shared/earsessionread'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** calmer after than before? Said only from what was measured in the two still checks; never that a practice treats anything */
export function verdict(r: SessionRead): { head: string; line: string } {
  if (!r.happened) return { head: 'The walk was not felt.', line: 'Your AirPods felt too few steps, so this run is not counted towards what helps you.' }
  const still = r.settle
  const heart = r.heartChange
  const parts: string[] = []
  if (heart !== null) parts.push(heart <= -1 ? `your heart rate came down ${Math.abs(Math.round(heart))} beats a minute` : heart >= 1 ? `your heart rate went up ${Math.round(heart)} beats a minute` : 'your heart rate stayed where it was')
  if (still !== null) parts.push(still >= 5 ? `your head sat ${still}% stiller` : still <= -5 ? `your head moved ${Math.abs(still)}% more` : 'your head moved as much as before')
  if (!parts.length) return { head: 'Done for today.', line: 'The checks before and after had too few AirPods samples to compare.' }
  const good = (heart !== null && heart <= -1 ? 1 : 0) + (still !== null && still >= 5 ? 1 : 0)
  const bad = (heart !== null && heart >= 1 ? 1 : 0) + (still !== null && still <= -5 ? 1 : 0)
  const head = good && !bad ? 'Calmer after.' : bad && !good ? 'Not calmer today.' : good && bad ? 'Mixed today.' : 'No change today.'
  const line = parts.join(' and ')
  return { head, line: `After the practice ${line}, against the same check just before it.` }
}

/** the heart row: before and after, and how often a reading came (null when nothing measured the heart) */
export function heartRow(r: SessionRead): { main: string; note: string; change: string } | null {
  if (!r.heartFrom) return null
  const swing =
    r.heartSwing !== null
      ? `; it swung ${r.heartSwing} beats with each breath at ${r.paceSlowest} a minute`
      : r.kind === 'breathe' && r.heartEveryS && r.paceSlowest
        ? r.heartEveryS <= 60 / r.paceSlowest / 3
          ? '; no swing with each breath stood out'
          : ': enough to see it settle, not to see it swing with each breath'
        : ''
  return {
    // whole beats, as the verdict and the clinic's screen say them: a reading a second does not carry tenths
    main: `${r.before.heartBpm === null ? 'not read' : Math.round(r.before.heartBpm)} before, ${r.after.heartBpm === null ? 'not read' : Math.round(r.after.heartBpm)} after`,
    note: ` (${r.heartSamples} readings from your AirPods${r.heartEveryS ? `, one about every ${r.heartEveryS} s` : ''}${swing})`,
    change: r.heartChange !== null ? `${Math.round(r.heartChange) > 0 ? '+' : ''}${Math.round(r.heartChange) || 0}` : '',
  }
}

export function stillRow(r: SessionRead): { main: string; change: string } {
  return {
    main: r.before.moveDegS !== null && r.after.moveDegS !== null ? `your head moved ${r.before.moveDegS}° a second before, ${r.after.moveDegS}° after` : 'not read: too few AirPods samples in a check',
    change: r.settle !== null ? (r.settle >= 0 ? `${r.settle}% stiller` : `${Math.abs(r.settle)}% more`) : '',
  }
}

export function breathRow(r: SessionRead): { main: string; own: string } {
  return {
    main: `the sound led from ${r.paceFirst} to ${r.paceLast} breaths a minute. ${
      r.followed > 0
        ? `Your AirPods felt your breath go with it in ${r.followed} of ${plural(r.checks, 'check')}, down to ${r.paceFollowed} a minute.`
        : r.checks > 0
          ? `Your breath could not be read from the AirPods in this run${r.byStillness ? `; the sound went by how still you sat (${r.byStillness} of ${plural(r.checks, 'check')})` : ''}.`
          : ''
    }`,
    own: r.paceOwn !== null ? `your own: ${r.paceOwn}` : '',
  }
}
