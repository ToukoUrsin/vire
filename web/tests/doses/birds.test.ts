// bun test: where the forest puts its birds, what it says when one is not found, and how the turn is measured.
import { describe, expect, test } from 'bun:test'
import { CAMERA_REACH_DEG, closer, createTurnMeter, emptyVisits, forestEndLine, placeBird, visit, whereWords } from '../../src/app/doses/birds'
import { wrap180 } from '../../src/app/doses/num'

const first = () => 0
const apart = (a: number, b: number) => Math.abs(wrap180(a - b))

describe('placing a bird', () => {
  test('it goes where the head has looked least', () => {
    const visits = emptyVisits()
    // the person has looked ahead and to their left, never to their right
    for (let b = -15; b <= 95; b += 10) visit(visits, b, 4)
    const bearing = placeBird(visits, 0, 'circle', [], first)
    expect(bearing).toBeLessThan(0)
    expect(apart(bearing, 0)).toBeGreaterThanOrEqual(30)
    expect(apart(bearing, 0)).toBeLessThanOrEqual(90)
  })

  test('it is a real turn away, but never behind the person', () => {
    for (const heading of [-170, -60, 0, 45, 175]) {
      const bearing = placeBird(emptyVisits(), heading, 'circle', [], Math.random)
      expect(apart(bearing, heading)).toBeGreaterThanOrEqual(30)
      expect(apart(bearing, heading)).toBeLessThanOrEqual(90)
    }
  })

  test('with only the camera it stays where the camera can follow the head', () => {
    const visits = emptyVisits()
    const found: number[] = []
    let heading = 0
    for (let i = 0; i < 3; i++) {
      const bearing = placeBird(visits, heading, CAMERA_REACH_DEG, found, Math.random)
      expect(Math.abs(bearing)).toBeLessThanOrEqual(CAMERA_REACH_DEG)
      expect(apart(bearing, heading)).toBeGreaterThanOrEqual(15)
      visit(visits, bearing, 5)
      found.push(bearing)
      heading = bearing
    }
  })

  test('three birds on the whole circle are three different directions', () => {
    const visits = emptyVisits()
    const found: number[] = []
    let heading = 0
    for (let i = 0; i < 3; i++) {
      const bearing = placeBird(visits, heading, 'circle', found, Math.random)
      for (const f of found) expect(apart(bearing, f)).toBeGreaterThanOrEqual(20)
      for (let b = heading; apart(b, bearing) > 5; b = wrap180(b + Math.sign(wrap180(bearing - b)) * 10)) visit(visits, b, 0.5)
      visit(visits, bearing, 3)
      found.push(bearing)
      heading = bearing
    }
    expect(found.length).toBe(3)
  })

  test('the second bird is not sent back to where the first was found', () => {
    const visits = emptyVisits()
    visit(visits, 0, 6)
    visit(visits, 45, 4)
    const bearing = placeBird(visits, 0, 'circle', [45], first)
    expect(apart(bearing, 45)).toBeGreaterThanOrEqual(20)
    expect(bearing).toBeLessThan(0)
  })
})

describe('a bird that is not found', () => {
  test('the words say which side and how far', () => {
    expect(whereWords(20, 0)).toBe('A little to your left. Turn that way.')
    expect(whereWords(-50, 0)).toBe('To your right. Turn that way.')
    expect(whereWords(100, 0)).toBe('Over your left shoulder. Turn that way.')
    expect(whereWords(-160, 0)).toBe('Behind your right shoulder. Turn that way.')
    expect(whereWords(-170, 170)).toBe('A little to your left. Turn that way.')
  })

  test('it comes a third of the way toward where the head points', () => {
    expect(closer(90, 0)).toBeCloseTo(60, 5)
    expect(closer(-60, 30)).toBeCloseTo(-30, 5)
    expect(apart(closer(170, -170), -170)).toBeCloseTo((20 * 2) / 3, 5)
  })
})

describe('how far the head turned', () => {
  test('left and right of the start add up', () => {
    const turn = createTurnMeter()
    for (const yaw of [0, 20, 50, 80, 40, 0, -30, -60, -20]) turn.feed(yaw)
    expect(turn.turned.left).toBe(80)
    expect(turn.turned.right).toBe(60)
    expect(turn.rangeDeg()).toBe(140)
  })

  test('a turn through the back reads as a turn, not as nothing', () => {
    const turn = createTurnMeter()
    for (let yaw = 0; yaw <= 200; yaw += 10) turn.feed(wrap180(yaw))
    expect(turn.rangeDeg()).toBe(200)
  })

  test('the end line', () => {
    expect(forestEndLine(140, 3)).toBe('You turned through 140 degrees and found 3 birds.')
    expect(forestEndLine(35, 1)).toBe('You turned through 35 degrees and found 1 bird.')
    expect(forestEndLine(12, 0)).toBe('You turned through 12 degrees. No bird was found this time.')
  })
})
