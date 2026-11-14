import { useId, useMemo } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { PatientDetail } from '@shared/types'
import { CH_LABEL, CH_VAR, DAY, DOSE_LABEL, airSaid, chLabel, fmtDay, fmtTime, fmtWeekday, signed, silentDays, words } from '../data'
import { BAND_HI, BAND_LO, clamp, lin, pathOf, useWidth } from './util'

type Ping = PatientDetail['timeline'][number]

/** x-domain shared by the main chart and the small multiples: start of the course (or first ping) to now */
export function timeDomain(detail: PatientDetail, now = Date.now()): [number, number] {
  const first = detail.timeline[0] ? Date.parse(detail.timeline[0].at) : now - 14 * DAY
  const start = detail.course ? Math.min(Date.parse(detail.course.start), first) : first - DAY
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return [Math.min(start, end.getTime() - 7 * DAY), end.getTime()]
}

export function dateTicks(t0: number, t1: number, width: number): number[] {
  const days = (t1 - t0) / DAY
  const want = Math.max(2, Math.floor(width / 64))
  const step = [1, 2, 7, 14, 28, 56].find((s) => days / s <= want) ?? 84
  const out: number[] = []
  const d = new Date(t1)
  d.setHours(0, 0, 0, 0)
  for (let t = d.getTime() - step * DAY; t > t0 + 0.4 * step * DAY; t -= step * DAY) out.unshift(t)
  return out
}

interface Props {
  detail: PatientDetail
  domain: [number, number]
  hover: number | null
  onHover: (i: number | null) => void
  /** the ping whose traces are shown below; click or Enter picks one */
  selected?: number | null
  onSelect?: (i: number) => void
}

/**
 * The pitch in one chart: echo strength from the first TMS session to today.
 * Course shaded, well signature as a band, clinic pings as open diamonds, home pings as dots,
 * the smoothed drift as a line that turns to the alert colour where it leaves the band.
 */
export function EchoChart({ detail, domain, hover, onHover, selected = null, onSelect }: Props) {
  const uid = useId()
  const [ref, W] = useWidth<HTMLDivElement>(1100)
  const narrow = W < 560
  const H = narrow ? 300 : 380
  const m = { l: narrow ? 36 : 44, r: narrow ? 58 : 92, t: 30, b: 52 }
  const pl = m.l
  const pr = W - m.r
  const pt = m.t
  const pb = H - m.b
  const [t0, t1] = domain
  const x = lin(t0, t1, pl, pr)
  const y = lin(0, 100, pb, pt)
  const tl = detail.timeline
  // a simulated person is simulated days with AirPods in: one mark a day, no camera-check re-measures, no old doses
  const air = detail.synthetic
  const Wd = words(air)

  const model = useMemo(() => {
    const full: { i: number; p: Ping; px: number }[] = []
    tl.forEach((p, i) => {
      if (p.kind === 'full') full.push({ i, p, px: x(Date.parse(p.at)) })
    })
    // in the clinic the pings themselves tell the story (ill to well); drift is a home measure
    const clinic = full.filter((f) => f.p.setting === 'clinic')
    const home = full.filter((f) => f.p.setting !== 'clinic')
    const drifted = home.length ? home : clinic.length ? [] : full
    const solid: ([number, number] | null)[] = []
    const gaps: string[] = []
    drifted.forEach((f, k) => {
      const pt2: [number, number] = [f.px, y(clamp(50 + 15 * f.p.drift, 0, 100))]
      const prev = drifted[k - 1]
      if (prev && Date.parse(f.p.at) - Date.parse(prev.p.at) > 3.5 * DAY) {
        const a = solid[solid.length - 1]
        if (a) gaps.push(`M${a[0].toFixed(1)},${a[1].toFixed(1)}L${pt2[0].toFixed(1)},${pt2[1].toFixed(1)}`)
        solid.push(null)
      }
      solid.push(pt2)
    })
    const linePts = solid.filter((p): p is [number, number] => p !== null)
    const yLo = y(BAND_LO)
    const area = linePts.length > 1 ? `${pathOf(linePts)}L${linePts[linePts.length - 1][0].toFixed(1)},${yLo}L${linePts[0][0].toFixed(1)},${yLo}Z` : ''
    const climb = pathOf(clinic.map((f): [number, number] => [f.px, y(f.p.strength)]))
    const latest = full[full.length - 1]?.p ?? null
    return { full, line: pathOf(solid), gaps, area, climb, end: linePts[linePts.length - 1] ?? null, endPing: drifted[drifted.length - 1]?.p ?? null, latest }
    // x and y are pure functions of these inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl, W, H, t0, t1])

  const lastFull = model.full[model.full.length - 1]?.p ?? null
  const silent = silentDays(detail.lastPingAt ?? lastFull?.at ?? null) ?? 0
  const latestPoint = model.latest ? { x: x(Date.parse(model.latest.at)), y: y(model.latest.strength) } : null
  const endStrength = model.latest ? Math.round(model.latest.strength) : null
  const endWord = detail.status === 'calibrating' ? 'calibrating' : detail.status === 'steady' ? 'in their usual' : detail.status
  // the end label is two short lines when its word is long, so it never runs past the right margin
  const endLines = narrow ? [] : `${air ? 'last day' : 'last check'} · ${endWord}`.length > 16 ? [air ? 'last day' : 'last check', endWord] : [`${air ? 'last day' : 'last check'} · ${endWord}`]
  // the band's own label sits at the band edge away from the end label, and is left out (the legend names the band) when both edges are taken
  const endBox = latestPoint ? [latestPoint.y - 18, latestPoint.y + 6 + endLines.length * 14] : null
  const clear = (ty: number) => !endBox || ty < endBox[0] || ty - 10 > endBox[1]
  const bandEdges = latestPoint && latestPoint.y < y(50) ? [y(BAND_LO) - 4, y(BAND_HI) + 12] : [y(BAND_HI) + 12, y(BAND_LO) - 4]
  const bandY = bandEdges.find(clear) ?? null
  const course = detail.course
  const cx0 = course ? clamp(x(Date.parse(course.start)), pl, pr) : 0
  const cx1 = course ? clamp(x(Date.parse(course.end)), pl, pr) : 0
  const ongoing = course ? Date.parse(course.end) > t1 : false
  const xt = dateTicks(t0, t1, pr - pl)
  const hp = hover !== null ? tl[hover] : null
  const hx = hp ? x(Date.parse(hp.at)) : 0
  const doseAt = (p: Ping) => detail.doses.find((d) => Math.abs(Date.parse(d.at) - Date.parse(p.at)) < 20 * 60_000) ?? null

  const nearest = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left
    let best = -1
    let bd = Infinity
    tl.forEach((p, i) => {
      if (air && p.kind === 'mini') return
      const d = Math.abs(x(Date.parse(p.at)) - mx) + (p.kind === 'mini' ? 3 : 0)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best < 0 ? null : best
  }
  const move = (e: PointerEvent<HTMLDivElement>) => onHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))
  const pick = (i: number | null) => {
    if (i === null || !onSelect) return
    // a mini ping has no full trace: pick the ping it re-measured
    let k = i
    while (k > 0 && tl[k].kind !== 'full') k--
    onSelect(k)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && hover !== null) return pick(hover)
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const cur = hover ?? tl.length - 1
    let next = clamp(cur + (e.key === 'ArrowLeft' ? -1 : 1), 0, tl.length - 1)
    while (air && tl[next]?.kind === 'mini' && next > 0 && next < tl.length - 1) next += e.key === 'ArrowLeft' ? -1 : 1
    onHover(next)
  }

  const tipW = 232
  const tipLeft = clamp(hx > W * 0.55 ? hx - tipW - 16 : hx + 16, 4, Math.max(4, W - tipW - 4))
  const tipDose = hp && !air ? doseAt(hp) : null

  return (
    <div
      ref={ref}
      className="cl-chart cl-echo"
      tabIndex={0}
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
      onClick={(e) => pick(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onKeyDown={key}
      onBlur={() => onHover(null)}
      role="group"
      aria-label={`${air ? 'Each day with AirPods in' : 'Each camera check'}, against their usual, from ${fmtDay(t0)} to today. Left and right arrow keys step through the ${Wd.many}.`}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          {/* the alert colour only applies at home: during the course a low echo is where everyone starts */}
          <clipPath id={`${uid}lo`}>
            <rect x={course ? cx1 : 0} y={y(BAND_LO)} width={W} height={H} />
          </clipPath>
        </defs>

        {course && (
          <g>
            <rect x={cx0} y={pt} width={Math.max(0, cx1 - cx0)} height={pb - pt} className="cl-course" />
            <rect x={cx0} y={pt - 4} width={Math.max(0, cx1 - cx0)} height={4} className="cl-course-bar" />
            <text x={cx0} y={pt - 11} className="cl-ax cl-ax--strong">
              {ongoing ? 'TMS course, in progress' : narrow ? 'TMS course' : `TMS course · ${course.sessions} sessions · ${air ? 'their usual set in its last two weeks' : 'calibrated in the clinic'}`}
            </text>
            {!ongoing && !narrow && cx1 + 150 < pr && (
              <text x={cx1 + 8} y={pt - 11} className="cl-ax">
                watched at home
              </text>
            )}
          </g>
        )}

        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pl} x2={pr} y1={y(v)} y2={y(v)} className={v === 0 ? 'cl-grid cl-grid--base' : 'cl-grid'} />
            <text x={pl - 8} y={y(v) + 4} textAnchor="end" className="cl-ax">
              {v}
            </text>
          </g>
        ))}

        {detail.phq2 && detail.phq2.length > 0 && (
          <g className="cl-phq2" aria-label="Weekly PHQ-2 answers">
            <line x1={pl} x2={pr} y1={y(50)} y2={y(50)} className="cl-phq2-axis" />
            {detail.phq2.map((q) => {
              // an answer given today stays inside the plot, clear of the labels in the right margin
              const px = Math.min(x(Date.parse(q.at)), pr - 6)
              const py = y(50 + (q.total - 3) * 10)
              return <circle key={q.id} cx={px} cy={py} r={5} className="cl-phq2-mark" />
            })}
          </g>
        )}

        <rect x={pl} y={y(BAND_HI)} width={pr - pl} height={y(BAND_LO) - y(BAND_HI)} className="cl-band" />
        <line x1={pl} x2={pr} y1={y(50)} y2={y(50)} className="cl-band-mid" />
        {bandY !== null && (
          <text x={pr + 10} y={bandY} className="cl-ax cl-ax--band">
            {detail.status === 'calibrating' ? (narrow ? 'typical' : 'typical range') : narrow ? 'usual' : 'their usual'}
          </text>
        )}

        {xt.map((t) => (
          <text key={t} x={x(t)} y={pb + 38} textAnchor="middle" className="cl-ax">
            {fmtDay(t)}
          </text>
        ))}
        <text x={pr} y={pb + 38} textAnchor="end" className="cl-ax cl-ax--strong">
          today
        </text>
        {course && <g className="cl-course-milestones">
          <line x1={cx1} x2={cx1} y1={pt + 22} y2={pb + 28} className="cl-milestone" />
          <text x={cx1} y={pt + 16} textAnchor="middle" className="cl-ax cl-ax--strong">course end</text>
          {/* only the months that have come: a milestone past today is not drawn, and none sits on its neighbour */}
          {[3, 6, 12].map((months) => {
            const mx = x(Date.parse(course.end) + months * 30.44 * DAY)
            if (mx > pr - 16 || mx < cx1 + 44) return null
            return <g key={months}><line x1={mx} x2={mx} y1={pt + 2} y2={pb + 24} className="cl-milestone" /><text x={mx} y={pt + 16} textAnchor="middle" className="cl-ax">{months} mo</text></g>
          })}
        </g>}

        {/* drift: the gap between the line and the band is the thing to see */}
        <path d={model.area} className="cl-drift-area" clipPath={`url(#${uid}lo)`} />
        {model.gaps.map((d, i) => (
          <path key={i} d={d} className="cl-drift-gap" />
        ))}
        <path d={model.climb} className="cl-climb" />
        <path d={model.line} className="cl-drift" />
        <path d={model.line} className="cl-drift cl-drift--under" clipPath={`url(#${uid}lo)`} />

        {/* pings */}
        {tl.map((p, i) => {
          const px = x(Date.parse(p.at))
          const py = y(p.strength)
          if (p.kind === 'mini') {
            if (air) return null
            let pre: Ping | null = null
            for (let k = i - 1; k >= 0; k--) {
              if (tl[k].kind === 'full') {
                pre = tl[k]
                break
              }
            }
            return (
              <g key={p.pingId}>
                {pre && <line x1={px} x2={px} y1={y(pre.strength)} y2={py} className="cl-lift" />}
                <circle cx={px} cy={py} r={2.4} className="cl-pt-mini" />
              </g>
            )
          }
          if (p.setting === 'clinic') {
            return <rect key={p.pingId} x={px - 3.6} y={py - 3.6} width={7.2} height={7.2} transform={`rotate(45 ${px} ${py})`} className="cl-pt-clinic" />
          }
          return <circle key={p.pingId} cx={px} cy={py} r={3.1} className="cl-pt-home" />
        })}

        {/* doses lane */}
        {!air && detail.doses.length > 0 && (
          <g>
            <text x={pl - 8} y={pb + 19} textAnchor="end" className="cl-ax">
              exercises
            </text>
            {detail.doses.map((d, i) => (
              <rect key={i} x={x(Date.parse(d.at)) - 1} y={pb + 10} width={2} height={9} rx={1} className={d.reward > 0 ? 'cl-dose' : 'cl-dose cl-dose--flat'} />
            ))}
          </g>
        )}

        {/* silence */}
        {silent >= 3 && lastFull && (
          <g>
            <line x1={x(Date.parse(lastFull.at))} x2={pr} y1={pb - 10} y2={pb - 10} className="cl-silence" />
            <text x={pr} y={pb - 17} textAnchor="end" className="cl-ax cl-ax--strong">
              {Wd.silent(silent)}
            </text>
          </g>
        )}

        {/* where the drift stands now */}
        {latestPoint && endStrength !== null && (
          <g>
            <circle cx={latestPoint.x} cy={latestPoint.y} r={5} className={`cl-end cl-end--${silent >= 3 ? 'quiet' : detail.status}`} />
            <text x={pr + 10} y={latestPoint.y - 1} className="cl-endv">
              {endStrength}
            </text>
            {endLines.map((line, i) => (
              <text key={line} x={pr + 10} y={latestPoint.y + 14 + i * 14} className="cl-ax">
                {line}
              </text>
            ))}
          </g>
        )}

        {selected !== null && tl[selected] && (
          <circle cx={x(Date.parse(tl[selected].at))} cy={y(tl[selected].strength)} r={7.5} className="cl-sel-ring" pointerEvents="none" />
        )}

        {hp && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={pt} y2={pb} className="cl-cross" />
            <circle cx={hx} cy={y(hp.strength)} r={6.5} className="cl-hover-ring" />
          </g>
        )}
      </svg>

      {hp && (
        <div className="cl-tip" style={{ left: tipLeft, width: tipW }} role="status">
          <div className="cl-tip-when">
            {fmtWeekday(hp.at)}, {fmtTime(hp.at)}
            <span>{hp.kind === 'mini' ? 'after an exercise' : hp.setting === 'clinic' ? (air ? 'in the clinic, during the course' : 'in the clinic') : 'at home'}</span>
          </div>
          <div className="cl-tip-main">
            <b>{Math.round(hp.strength)}</b>
            <span>
              {air ? 'this day, 50 is their usual' : 'this check, 50 is their usual'}
              {hp.kind === 'full' && <em>drift {signed(hp.drift)} SD</em>}
            </span>
          </div>
          <div className="cl-tip-rows">
            {hp.components.map((c) =>
              air ? (
                <div key={c.channel} className={c.value === null ? 'is-off' : ''}>
                  <i style={{ background: CH_VAR[c.channel] }} />
                  <span>{chLabel(c.channel, true)}</span>
                  <b>{c.value === null ? 'not read' : c.z === null ? '' : Math.round(c.strength)}</b>
                  <em>{c.value === null ? '' : airSaid(c.channel, c.z)}</em>
                </div>
              ) : (
                <div key={c.channel} className={c.value === null ? 'is-off' : ''}>
                  <i style={{ background: CH_VAR[c.channel] }} />
                  <span>{CH_LABEL[c.channel]}</span>
                  <b>{c.value === null ? 'not measured' : c.z === null ? '' : Math.round(c.strength)}</b>
                  <em>{c.value === null ? '' : `${c.value} ${detail.signature.find((s) => s.channel === c.channel)?.unit ?? ''}`}</em>
                </div>
              ),
            )}
          </div>
          {tipDose && (
            <div className="cl-tip-dose">
              {DOSE_LABEL[tipDose.dose]}: {signed(tipDose.reward, 0)} points
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function EchoLegend({ calibrating = false, air = false, phq2 = false }: { calibrating?: boolean; air?: boolean; phq2?: boolean }) {
  return (
    <div className="cl-legend" aria-hidden="true">
      <span>
        <svg width="14" height="14">
          <rect x="3.4" y="3.4" width="7.2" height="7.2" transform="rotate(45 7 7)" className="cl-pt-clinic" />
        </svg>
        {air ? 'day in the clinic' : 'check in the clinic'}
      </span>
      <span>
        <svg width="14" height="14">
          <circle cx="7" cy="7" r="3.1" className="cl-pt-home" />
        </svg>
        {air ? 'day at home' : 'check at home'}
      </span>
      {!air && (
        <span>
          <svg width="14" height="14">
            <line x1="7" x2="7" y1="12" y2="4" className="cl-lift" />
            <circle cx="7" cy="4" r="2.4" className="cl-pt-mini" />
          </svg>
          re-measured after an exercise
        </span>
      )}
      <span>
        <svg width="18" height="14">
          <rect x="1" y="2" width="16" height="10" rx="2" className="cl-band" />
          <line x1="1" x2="17" y1="7" y2="7" className="cl-band-mid" />
        </svg>
        {calibrating ? 'typical range, until their own is known' : 'their usual'}
      </span>
      <span>
        <svg width="22" height="14">
          <path d="M1,7 L11,7" className="cl-drift" />
          <path d="M11,7 L21,7" className="cl-drift cl-drift--under" />
        </svg>
        drift at home, red under their usual
      </span>
      {phq2 && (
        <span>
          <svg width="14" height="14">
            <circle cx="7" cy="7" r="4.4" className="cl-phq2-mark" />
          </svg>
          PHQ-2 answer, self-report
        </span>
      )}
      {phq2 && (
        <span>
          <svg width="22" height="14">
            <line x1="1" x2="21" y1="7" y2="7" className="cl-phq2-axis" />
          </svg>
          PHQ-2 cut-off, 3 or more
        </span>
      )}
    </div>
  )
}
