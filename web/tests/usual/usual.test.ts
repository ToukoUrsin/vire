import { describe, expect, test } from 'bun:test'
import type { EarDay } from '../../src/tune/usual/measures'
import { usualRows } from '../../src/tune/usual/usual.ts'

const day = (value: number | null, at = ''): EarDay => ({ at, smiles: value ?? 0, asked: 6, smileDeg: value, nodHz: value, nodDeg: value, shakeHz: value, shakeDeg: value, moveDegS: value ?? 0 })

describe('usual bands', () => {
  test('has no band with no earlier minutes', () => {
    const row = usualRows([day(4)])[0]
    expect(row.today).toBe(4)
    expect(row.earlier).toEqual([])
    expect(row.lo).toBeNull()
    expect(row.hi).toBeNull()
    expect(row.mid).toBeNull()
    expect(row.where).toBe('no usual yet')
  })

  test('keeps one earlier value but still has no usual band', () => {
    const row = usualRows([day(2), day(4)])[0]
    expect(row.earlier).toEqual([2])
    expect(row.where).toBe('no usual yet')
  })

  test('uses min and max, a tenth of the middle wider, for two to four earlier values', () => {
    const row = usualRows([day(2), day(5), day(3), day(7), day(9)])[0]
    expect(row.earlier).toEqual([2, 5, 3, 7])
    expect(row.lo).toBeCloseTo(1.6, 9)
    expect(row.hi).toBeCloseTo(7.4, 9)
    expect(row.mid).toBe(4)
    expect(row.where).toBe('above')
  })

  test('two earlier minutes that agree do not put a hair of difference outside the usual', () => {
    expect(usualRows([day(1.25), day(1.25), day(1.2)])[0].where).toBe('within')
    expect(usualRows([day(1.25), day(1.25), day(0.9)])[0].where).toBe('below')
  })

  test('uses the tenth and ninetieth percentiles at five earlier values', () => {
    const row = usualRows([day(0), day(10), day(20), day(30), day(40), day(25)])[0]
    expect(row.earlier).toEqual([0, 10, 20, 30, 40])
    expect(row.lo).toBe(4)
    expect(row.hi).toBe(36)
    expect(row.mid).toBe(20)
    expect(row.where).toBe('within')
  })

  test('leaves null values out of each row', () => {
    const rows = usualRows([day(1), day(null), day(3), day(2)])
    expect(rows[0].earlier).toEqual([1, 0, 3])
    expect(rows[1].earlier).toEqual([1, 3])
    expect(rows[1].today).toBe(2)
  })

  test('compares the latest value below, within and above the band', () => {
    expect(usualRows([day(2), day(4), day(1)])[0].where).toBe('below')
    expect(usualRows([day(2), day(4), day(3)])[0].where).toBe('within')
    expect(usualRows([day(2), day(4), day(8)])[0].where).toBe('above')
  })
})
