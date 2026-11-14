// bun test tests/session/length.test.ts: how long a practice runs and which time of day suits a person are only
// said from that person's own practices, and only when there are enough of them.
import { expect, test } from 'bun:test'
import { dayPart, learnLength, learnWhen, LENGTH_DEFAULT_S } from '../../../shared/earlearn'

test('the length starts at the default and follows how long the person took to reach six a minute', () => {
  expect(learnLength([])).toEqual({ n: 0, of: 0, reachS: null, nextS: LENGTH_DEFAULT_S })
  // an older practice without the time is left out, not counted as a miss
  expect(learnLength([{ kind: 'breathe', paceSlowest: 6 }]).of).toBe(0)
  // never got to six: a little longer next time
  expect(learnLength([{ kind: 'breathe', paceSlowest: 7, slowestAtS: 100 }])).toEqual({ n: 0, of: 1, reachS: null, nextS: 180 })
  // reached it after 95 s: a minute there on top, to the nearest ten seconds
  expect(learnLength([{ kind: 'breathe', paceSlowest: 6, slowestAtS: 95 }]).nextS).toBe(160)
  // the middle one of three, and other practices do not count
  const got = learnLength([
    { kind: 'breathe', paceSlowest: 6, slowestAtS: 60 },
    { kind: 'breathe', paceSlowest: 6, slowestAtS: 130 },
    { kind: 'breathe', paceSlowest: 6, slowestAtS: 90 },
    { kind: 'scan', paceSlowest: null, slowestAtS: null },
  ])
  expect(got).toEqual({ n: 3, of: 3, reachS: 90, nextS: 150 })
  // never shorter than two minutes, never longer than three and a half
  expect(learnLength([{ kind: 'breathe', paceSlowest: 6, slowestAtS: 5 }]).nextS).toBe(120)
  expect(learnLength([{ kind: 'breathe', paceSlowest: 6, slowestAtS: 400 }]).nextS).toBe(210)
})

test('a time of day is only said with two practices in each of two parts and a clear lead', () => {
  expect(dayPart(8)).toBe('morning')
  expect(dayPart(21)).toBe('evening')
  expect(dayPart(2)).toBe('night')
  expect(learnWhen([{ hour: 21, settle: 40 }]).best).toBeNull()
  expect(learnWhen([{ hour: 21, settle: 40 }, { hour: 20, settle: 30 }, { hour: 8, settle: 5 }]).best).toBeNull()
  const got = learnWhen([
    { hour: 21, settle: 40 },
    { hour: 20, settle: 30 },
    { hour: 8, settle: 5 },
    { hour: 9, settle: 15 },
    { hour: 9, settle: null },
    { hour: null, settle: 90 },
    { hour: 10, settle: 80, happened: false },
  ])
  expect(got.best).toBe('evening')
  expect(got.total).toBe(4)
  expect(got.parts.find((p) => p.part === 'morning')).toEqual({ part: 'morning', n: 2, mean: 10 })
  // close together: nothing is said
  expect(learnWhen([{ hour: 21, settle: 22 }, { hour: 20, settle: 20 }, { hour: 8, settle: 15 }, { hour: 9, settle: 19 }]).best).toBeNull()
})
