#!/usr/bin/env node
// Writes film/index.html, the HyperFrames composition (film/render.sh runs this; don't edit index.html by hand).
// Everything the film shows or says comes from one of these, so when the product changes the two commands
// (film/capture.sh, film/render.sh vN) are enough:
//   assets/capture/meta.json        the capture: the product's own words and numbers, when things happened, where
//                                   things sit on the big screen (scripts/capture.mjs)
//   assets/vo/<id>.json             the narration and the time of every word (scripts/gen-vo.mjs)
//   ../web/public/validation.json   the sensing checks
//   pitch/claims.md                 the two figures from papers (46.3%, 20 to 30 sessions): typed here
import fs from 'node:fs'
import path from 'node:path'
const film = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const read = (p) => JSON.parse(fs.readFileSync(path.join(film, p), 'utf8'))
const cap = read('assets/capture/meta.json')
const val = read('../web/public/validation.json')
const VO = {}
for (const f of fs.readdirSync(path.join(film, 'assets/vo'))) if (/^[a-z]\d\.json$/.test(f)) VO[f.slice(0, -5)] = read(`assets/vo/${f}`)

const r2 = (x) => Math.round(x * 100) / 100
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fail = (m) => {
  console.error('build: ' + m)
  process.exit(2)
}

// ---------------------------------------------------------------- the capture
const P = cap.product ?? {}
const ping = P.ping ?? fail('the capture has no ping for the film (run film/capture.sh again)')
const F = ping.features
const echo = ping.echo ?? fail('the server did not answer the film ping')
const comp = Object.fromEntries((echo.components ?? []).map((c) => [c.channel, c]))
for (const ch of ['smile', 'voice', 'heart', 'move']) if (!comp[ch]) fail(`the film ping did not read "${ch}" (unreadable: ${ping.unreadable})`)
const seconds = (f) => cap.videos?.[f]?.seconds ?? fail(`the capture has no ${f}.mp4`)
const AT = P.at ?? {}
/** where a part of a captured page sat: [x, y, w, h] in page px (".class:2" is the second of its kind) */
const rect = (tag, cls, fallback) => cap.rects?.[tag]?.[cls] ?? fallback
const pad = ([x, y, w, h], p, q = p) => {
  const x0 = Math.max(0, x - p)
  const y0 = Math.max(0, y - q)
  return [x0, y0, Math.min(1920, x + w + p) - x0, Math.min(1080, y + h + q) - y0]
}
// What the big screen wrote under each step when it was done ("Nod 12° at 69°/s  Laugh smile in 2.4 s ..."). The
// film's numbers for the minute are these, because these are the numbers visible in the footage. (The phone
// uploads its own reading of the same signals, which can differ a little: see film/README.md.)
const rail = [P.said?.echo, P.said?.again, P.said?.breathe].find((t) => /smile in/.test(t ?? '')) ?? ''
const grab = (re, fallback) => {
  const m = re.exec(rail)
  return m ? Number(m[1]) : fallback
}
const N = {
  nodVel: grab(/Nod\s+-?\d+°\s+at\s+(\d+)°\/s/, Math.round(F.move?.nodPeakVelDegS ?? 0)),
  nodDeg: grab(/Nod\s+(-?\d+)°\s+at/, Math.round(F.move?.nodAmplitudeDeg ?? 0)),
  laugh: grab(/smile in\s+([\d.]+)\s*s/, r2((F.smile?.latencyMs ?? fail('the film ping has no smile latency')) / 1000)),
  voice: grab(/Speak\s+([\d.]+)\s+semitones/, F.voice?.f0SdSemitones ?? 0),
  swing: grab(/swing\s+(\d+)\s*bpm/, F.heart?.swingBpm ?? 0),
  rest: grab(/resting pulse\s+(\d+)/, Math.round(F.heart?.restBpm ?? 0)),
  held: r2((F.smile?.durationMs ?? 0) / 1000),
}
// when the wireframe face lights up in the laugh shot and in the re-measure (the big screen runs a little behind
// the phone; an older capture has no such mark, so guess it)
const laughAt = AT.laughter ?? 2
const lit = AT.faceLit ?? r2(laughAt + N.laugh + (cap.stageLag == null ? 1.0 : 0))
const miniLat = (P.mini?.features?.smile?.latencyMs ?? 2000) / 1000
const lit2 = AT.faceLit2 ?? r2((AT.miniLaugh ?? 5) + 0.6 + miniLat + (cap.stageLag == null ? 1.0 : 0))

// ---------------------------------------------------------------- the schedule: narration lines, back to back
// Put the checked-so-far cards before the clinic sequence. The short list and the
// one-tap patient action are the payoff; the proof cards now set that payoff up
// instead of cutting away from it afterward.
const ORDER = [['h1', 0.2], ['h2', 0.05], ['h3', 0.3], ['m1', 0.5], ['m2', 0.45], ['m3', 0.45], ['m4', 0.45], ['e1', 0.9], ['e2', 0.35],
  ['d1', 0.6], ['d2', 0.9], ['p1', 0.7], ['p2', 0.4], ['p3', 0.4], ['c1', 0.8], ['c2', 0.35], ['c3', 0.4], ['z1', 0.6]]
const at = {}
const end = {}
{
  let t = 0
  for (const [id, gap] of ORDER) {
    if (!VO[id]) fail(`no narration line ${id} (hsec exec --only ELEVENLABS_API_KEY -- node film/scripts/gen-vo.mjs)`)
    t += gap
    at[id] = r2(t)
    t += VO[id].dur
    end[id] = r2(t)
  }
}
const TOTAL = r2(end.z1 + 2.4)
/** when a word of a line is spoken (film time) */
const said = (id, w) => {
  const i = VO[id].words.findIndex((x) => x.text.toLowerCase().startsWith(w.toLowerCase()))
  if (i < 0) fail(`line ${id} has no word "${w}"`)
  return r2(at[id] + VO[id].words[i].start)
}
const S = {
  hook: [0, r2(at.h2 - 0.2)],
  name: [r2(at.h2 - 0.2), r2(at.h3 - 0.2)],
  why: [r2(at.h3 - 0.2), r2(at.m1 - 0.3)],
  min: [r2(at.m1 - 0.3), r2(at.e1 - 0.6)],
  echo: [r2(at.e1 - 0.6), r2(at.d1 - 0.35)],
  dose: [r2(at.d1 - 0.35), r2(at.p1 - 0.5)],
  proof: [r2(at.p1 - 0.5), r2(at.c1 - 0.4)],
  clinic: [r2(at.c1 - 0.4), r2(at.z1 - 0.35)],
  close: [r2(at.z1 - 0.35), TOTAL],
}

// ---------------------------------------------------------------- building blocks
const body = []
const js = []
const sound = []
let track = 1
const J = (s) => js.push(s)
const q = JSON.stringify
/** an element rises into place */
const enter = (sel, t, o = {}) =>
  J(`tl.fromTo(${q(sel)},{opacity:0,x:${o.x ?? 0},y:${o.y ?? 34},scale:${o.scale ?? 1}},{opacity:1,x:0,y:0,scale:1,duration:${o.dur ?? 0.7},ease:${q(o.ease ?? 'expo.out')}${o.stagger ? `,stagger:${o.stagger}` : ''}},${r2(t)})`)
/** a hidden block appears (and can be taken away again with `hide`) */
const show = (sel, t, o = {}) => J(`tl.fromTo(${q(sel)},{autoAlpha:0,x:${o.x ?? 0},y:${o.y ?? 0}},{autoAlpha:1,x:0,y:0,duration:${o.dur ?? 0.5},ease:"expo.out"},${r2(t)})`)
const hide = (sel, t) => J(`tl.set(${q(sel)},{autoAlpha:0},${r2(t)})`)
const fadeIn = (sel, t, dur = 0.4) => J(`tl.fromTo(${q(sel)},{opacity:0},{opacity:1,duration:${dur},ease:"power2.out"},${r2(t)})`)
/** a number runs up to its value */
const count = (sel, t, to, o = {}) =>
  J(`{const el=document.querySelector(${q(sel)}),o={v:${o.from ?? 0}};tl.to(o,{v:${to},duration:${o.dur ?? 1.1},ease:${q(o.ease ?? 'power2.out')},onUpdate:()=>{el.textContent=${q(o.pre ?? '')}+o.v.toFixed(${o.dp ?? 0})+${q(o.post ?? '')}}},${r2(t)})}`)
/** a slow move in on a picture, so a held shot is never dead */
const drift = (sel, t0, t1, o = {}) =>
  J(`tl.fromTo(${q(sel)},{scale:${o.from ?? 1}},{scale:${o.to ?? 1.05},duration:${r2(t1 - t0)},ease:"none",transformOrigin:${q(o.origin ?? '50% 50%')}},${r2(t0)})`)
const pop = (sel, t, o = {}) =>
  J(`tl.fromTo(${q(sel)},{scale:1},{scale:${o.to ?? 1.12},duration:0.16,ease:"power2.out",yoyo:true,repeat:1,transformOrigin:${q(o.origin ?? '0% 60%')},immediateRender:false},${r2(t)})`)

/** a piece of captured video, timed; clamps to what the capture has */
function video(id, file, t0, t1, from, style = '', rate = 1) {
  const have = seconds(file)
  const ms = Math.max(0, Math.min(from, have - 0.5))
  const dur = Math.min(t1 - t0, (have - ms - 0.05) / rate)
  if (dur < t1 - t0 - 0.25) console.warn(`build: ${file} is ${have}s; "${id}" wanted ${r2(ms)}..${r2(ms + (t1 - t0) * rate)}, so it holds its last frame for ${r2(t1 - t0 - dur)}s`)
  return `<video class="clip" id="${id}" muted playsinline src="assets/capture/${file}.mp4" data-start="${r2(t0)}" data-duration="${r2(dur)}" data-media-start="${r2(ms)}"${rate !== 1 ? ` data-playback-rate="${rate}"` : ''} data-track-index="${track++}"${style ? ` style="${style}"` : ''}></video>`
}
/** a window onto one part of a captured page: `r` (page px) fills a box no bigger than `box`, kept in proportion */
function crop(id, file, r, box, t0, t1, from, o = {}) {
  const page = o.page ?? [1920, 1080]
  const k = Math.min(box[2] / r[2], box[3] / r[3])
  const w = Math.round(r[2] * k)
  const h = Math.round(r[3] * k)
  const x = o.right ? box[0] + box[2] - w : o.center ? Math.round(box[0] + (box[2] - w) / 2) : box[0]
  const y = o.top ? box[1] : Math.round(box[1] + (box[3] - h) / 2)
  const vs = `left:${r2(-r[0] * k)}px;top:${r2(-r[1] * k)}px;width:${r2(page[0] * k)}px;height:${r2(page[1] * k)}px`
  return {
    box: [x, y, w, h],
    k,
    html: `<div class="crop${o.cls ? ' ' + o.cls : ''}" id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><div class="zoom" id="${id}-z">${video(id + '-v', file, t0, t1, from, vs, o.rate ?? 1)}</div>${o.tag ? `<div class="tag">${esc(o.tag)}</div>` : ''}</div>`,
  }
}
// the phone, full height, at the size it was recorded
const PHONE_Y = 64
const PHONE_H = 836
const PHONE_W = Math.round((PHONE_H * 390) / 844)
/** `clips` = [[file, from t, to t, media start, rate], ...] */
const phone = (id, x, clips) =>
  `<div class="phone" id="${id}" style="left:${x}px;top:${PHONE_Y}px;width:${PHONE_W}px;height:${PHONE_H}px">${clips.map(([f, a, b, ms, rate], i) => video(`${id}-v${i + 1}`, f, a, b, ms, '', rate ?? 1)).join('')}</div>`
function scene(id, inner) {
  const [a, b] = S[id]
  body.push(`<div class="scene${a === 0 ? ' first' : ''}" id="s-${id}">\n${inner}\n</div>`)
  if (a > 0) J(`tl.set("#s-${id}",{autoAlpha:1},${a})`)
  if (b < TOTAL) J(`tl.set("#s-${id}",{autoAlpha:0},${b})`)
}
const audio = (id, src, t0, dur, o = {}) =>
  sound.push(`<audio id="${id}" src="${src}" data-start="${r2(t0)}" data-duration="${r2(dur)}"${o.from != null ? ` data-media-start="${r2(o.from)}"` : ''} data-volume="${o.vol ?? 1}"${o.in ? ` data-fade-in="${o.in}"` : ''}${o.out ? ` data-fade-out="${o.out}"` : ''} data-track-index="${track++}"></audio>`)
/** the app's own sound from a shot */
function appSound(id, shot, t0, t1, from, o = {}) {
  const file = path.join(film, `assets/capture/snd-${shot}.wav`)
  if (!fs.existsSync(file) || fs.statSync(file).size < 20000) return
  const have = (fs.statSync(file).size - 44) / (48000 * 4)
  const ms = Math.max(0, Math.min(from, have - 0.3))
  const dur = Math.min(t1 - t0, have - ms)
  if (dur > 0.3) audio(id, `assets/capture/snd-${shot}.wav`, t0, dur, { from: ms, ...o })
}
const SRC = (t) => `<div class="src">${t}</div>`
const TEST = 'Recorded face played into the phone\'s camera. The rest is the live product.'

// the frame: headline on top, content between CY and CY + CH, captions under it, the source line at the bottom
const CY = 236
const CH = 660
const COL = 560 // where things start to the right of a phone at the left edge
const FACE = (tag) => {
  const fb = rect(tag, '.sg-facebox', rect('laugh', '.sg-facebox', [46, 134, 545, 766]))
  return [fb[0], Math.round(fb[1] + fb[3] * 0.07), fb[2], Math.round(fb[3] * 0.8)] // the box has air above and below the face
}
const STEP_PANEL = (tag) => rect(tag, '.sg-panel:2', [1295, 361, 579, 356]) // the middle panel: what this step measures
const HEAD_PANEL = (tag) => rect(tag, '.sg-panel', [922, 361, 355, 574]) // the drawn head, moved by the AirPods

// ================================================================ 1. hook: the face answers the laugh
{
  const [a, b] = S.hook
  // the laughter starts T0 into the film; the face lights up N.laugh seconds later, as the big screen measured it
  const T0 = r2(Math.max(0.35, N.laugh - lit + 0.05))
  const stageFrom = r2(lit - N.laugh - T0)
  const phoneFrom = r2(Math.max(0, laughAt - T0))
  const face = crop('hook-face', 'stage-laugh', FACE('laugh'), [96, CY, 640, CH], a, b, stageFrom)
  const nx = face.box[0] + face.box[2] + 64
  const nw = 1438 - 56 - nx
  scene('hook', `<div class="h" id="hook-h">It plays a laugh.<br><span class="warm" id="hook-h2">Then it times the smile that comes back.</span></div>
${face.html}
<div class="read" id="hook-read" style="left:${nx}px;top:${CY + 60}px;width:${nw}px"><div class="q">From the laugh to the smile</div><div class="num smile" id="hook-n">0.0 s</div><div class="lab" id="hook-l">measured in this recording</div></div>
<div class="note" id="hook-note" style="left:${nx}px;top:${CY + 430}px;width:${nw}px">Left: what the phone's camera reads, drawn live on the big screen. Face muscles, never the picture.</div>
${phone('hook-phone', 1438, [['phone-laugh', a, b, phoneFrom]])}
${SRC(TEST)}`)
  enter('#hook-h', 0.1, { y: 24, dur: 0.6 })
  fadeIn('#hook-h2', said('h1', 'Then') - 0.25, 0.5)
  enter('#hook-read', Math.max(0.1, T0 - 0.2), { y: 0, x: -24, dur: 0.5 })
  count('#hook-n', T0, N.laugh, { dur: N.laugh, ease: 'none', dp: 1, post: ' s' })
  pop('#hook-n', T0 + N.laugh)
  fadeIn('#hook-l', T0 + N.laugh + 0.1, 0.4)
  enter('#hook-note', said('h1', 'Then') + 0.5, { y: 16 })
  drift('#hook-face-z', a, b, { to: 1.05 })
  // the laugh is the first thing you hear: alone for a moment, then under the voice
  appSound('snd-hook-a', 'laugh', a, at.h1 + 0.2, phoneFrom, { vol: 0.9, out: 0.3 })
  appSound('snd-hook-b', 'laugh', at.h1 - 0.1, b, phoneFrom + at.h1 - 0.1, { vol: 0.18, in: 0.3, out: 0.4 })
}

// ================================================================ 2. name: what it is
{
  const [a, b] = S.name
  scene('name', `${phone('name-phone', 150, [['phone-settle', a, b, 0.6]])}
<div class="wordmark" id="name-w">Vire</div>
<div class="big" id="name-1" style="left:690px;top:410px;font-size:62px;white-space:normal;max-width:1040px">TMS is magnetic brain stimulation for depression: 20 to 30 clinic visits.</div>
<div class="big dim" id="name-2" style="left:690px;top:590px;font-size:62px;white-space:normal;max-width:1040px">Vire checks you for one minute a day at home.</div>
<div class="note" id="name-3" style="left:690px;top:760px;width:1000px">A course is usually 20 to 30 clinic sessions over 4 to 6 weeks. Then you go home.</div>
${SRC('Course length: Perera et al. 2016, Brain Stimulation')}`)
  enter('#name-phone', a, { y: 60, dur: 0.9 })
  enter('#name-w', a + 0.1, { y: 40, dur: 0.8 })
  enter('#name-1', said('h2', 'TMS') - 0.15, { y: 26 })
  enter('#name-2', said('h2', 'Vire') - 0.15, { y: 26 })
  enter('#name-3', said('h2', 'Vire') + 0.9, { y: 16 })
}

// ================================================================ 3. why: it stops working, and nobody sees who
{
  const [a, b] = S.why
  const back = said('h3', 'Vire')
  // a first look at the clinic's list: names, days since the course, the echo line, the status
  const g = rect('clinic-list', '.cl-group', [280, 306, 1360, 464])
  const reason = rect('clinic-list', '.cl-c-reason', [1085, 347, 387, 65])
  const rows = crop('why-list', 'clinic-list', [g[0], g[1] - 6, reason[0] - 24 - g[0], Math.min(g[3], 470)], [1010, 372, 814, 500], back - 0.2, b, 0.5, { top: true })
  scene('why', `<div class="h" id="why-h">Within a year, it stops working for about half.</div>
<div class="num huge ember" id="why-n">0%</div>
<div class="lab wide" id="why-l" style="left:100px;top:650px">still respond 12 months after TMS</div>
<div class="tagline" id="why-t" style="left:1010px;top:290px">Vire shows the clinic who to call back.</div>
${rows.html}
<div class="pill sm" id="why-sim" style="left:${rows.box[0] + rows.box[2] - 252}px;top:${rows.box[1] + rows.box[3] + 16}px">Simulated patients</div>
${SRC('Senova et al. 2019 · 9 studies · 247 patients')}`)
  enter('#why-h', a + 0.05, { y: 24, dur: 0.6 })
  enter('#why-n', a + 0.15, { y: 50, dur: 0.8 })
  count('#why-n', a + 0.2, 46.3, { dur: 1.5, dp: 1, post: '%' })
  enter('#why-l', a + 0.7, { y: 20 })
  enter('#why-t', back - 0.25, { x: 40, y: 0 })
  enter('#why-list', back - 0.1, { x: 60, y: 0, dur: 0.8 })
  fadeIn('#why-sim', back + 0.3)
  drift('#why-list-z', back - 0.2, b, { to: 1.05, origin: '0% 0%' })
}

// ================================================================ 4. the minute: four small things
{
  const [a, b] = S.min
  const BOX = [COL, CY, 820, CH]
  const first = r2(said('m1', 'A') - 0.2) // "A nod": until then, both screens together
  const nodAt = AT.nod ?? 1.9
  const steps = [
    { id: 'm1', key: 'nod', name: 'Nod', q: 'How big, how quick?', r: HEAD_PANEL('nod'), from: Math.max(0, nodAt - 1.0), pfrom: Math.max(0, nodAt - 1.0),
      n: N.nodVel, unit: '° a second', more: `at its fastest · ${Math.abs(N.nodDeg)}° deep`, col: 'move' },
    { id: 'm2', key: 'laugh', name: 'Laugh', q: 'How fast does the smile come?', r: STEP_PANEL('laugh'), from: Math.max(0, lit - 1.3), pfrom: Math.max(0, laughAt + N.laugh - 1.3),
      n: N.laugh, dp: 1, unit: 'seconds', more: `from the laugh to the smile${N.held ? ` · held ${N.held.toFixed(1)} s` : ''}`, col: 'smile' },
    { id: 'm3', key: 'speak', name: 'Speak', q: 'How much does your voice rise and fall?', r: STEP_PANEL('speak'), from: 5.2, pfrom: 4.6,
      n: N.voice, dp: 1, unit: 'semitones', more: 'of pitch movement in one sentence', col: 'voice' },
    { id: 'm4', key: 'breathe', name: 'Breathe', q: 'How far does your heart rate swing?', r: STEP_PANEL('breathe'), from: 1.6, pfrom: 1.0, rate: 4,
      n: N.swing, dp: 0, unit: 'beats a minute', more: `lowest to highest, over two slow breaths${N.rest ? ` · ${N.rest} at rest` : ''}`, col: 'heart' },
  ]
  const cuts = steps.map((s, i) => (i === 0 ? first : r2(at[s.id] - 0.22)))
  const outs = steps.map((s, i) => (i + 1 < steps.length ? cuts[i + 1] : b))
  const wide = crop('min-wide', 'stage-settle', [0, 124, 1920, 956], [COL, CY, 1264, CH], a, first, 1.0, { tag: 'The big screen at the table shows what the phone reads' })
  let inner = phone('min-phone', 96, [['phone-settle', a, first, 1.0], ...steps.map((s, i) => [`phone-${s.key}`, cuts[i], outs[i], s.pfrom, s.rate])])
  inner += `\n<div class="h" id="min-h" style="left:${COL}px">One minute. Four small things.</div>\n<div class="rail" id="min-rail" style="left:${COL + 2}px;top:150px">${steps.map((s, i) => `<span class="chip" id="min-c${i + 1}"><i>${i + 1}</i>${s.name}</span>`).join('')}</div>\n${wide.html}`
  hide('#min-wide', first)
  steps.forEach((s, i) => {
    const c = crop(`min-p${i + 1}`, `stage-${s.key}`, s.r, BOX, cuts[i], outs[i], s.from, { rate: s.rate, tag: s.rate ? `${s.rate}× speed` : '' })
    inner += `\n${c.html}\n<div class="read" id="min-r${i + 1}" style="left:1436px;top:${CY + 40}px;width:388px"><div class="q">${esc(s.q)}</div><div class="num ${s.col}" id="min-n${i + 1}">${(0).toFixed(s.dp ?? 0)}</div><div class="unit ${s.col}">${esc(s.unit)}</div><div class="lab">${esc(s.more)}</div></div>`
    const t = cuts[i]
    if (i > 0) hide(`#min-p${i},#min-r${i}`, t)
    show(`#min-p${i + 1}`, t, { x: 50 })
    show(`#min-r${i + 1}`, t + 0.25, { y: 24 })
    // the number lands as the question ends
    count(`#min-n${i + 1}`, Math.max(t + 0.9, end[s.id] - 1.9), s.n, { dur: 1.0, dp: s.dp ?? 0 })
    J(`tl.to("#min-c${i + 1}",{color:"#14110d",backgroundColor:"var(--${s.col})",borderColor:"var(--${s.col})",duration:0.25},${r2(t + 0.05)})`)
    if (i + 1 < steps.length) J(`tl.to("#min-c${i + 1}",{color:"#a79f90",backgroundColor:"rgba(0,0,0,0)",borderColor:"#3a3229",duration:0.25},${outs[i]})`)
    drift(`#min-p${i + 1}-z`, t, outs[i], { to: 1.04 })
  })
  inner += `\n${SRC('Live product capture · the numbers are the ones the app shows here.')}`
  scene('min', inner)
  enter('#min-phone', a, { y: 50, dur: 0.8 })
  enter('#min-h', a + 0.05, { y: 24, dur: 0.6 })
  enter('#min-rail .chip', a + 0.25, { y: 14, dur: 0.5, stagger: 0.07 })
  enter('#min-wide', a + 0.05, { x: 50, y: 0, dur: 0.7 })
  drift('#min-wide-z', a, first, { to: 1.03 })
  // the laugh again, quietly, where it belongs
  appSound('snd-min-laugh', 'laugh', cuts[1], outs[1], steps[1].pfrom, { vol: 0.2, in: 0.2, out: 0.4 })
}

// ================================================================ 5. the echo: today against your own usual
{
  const [a, b] = S.echo
  const names = { smile: 'Smile', voice: 'Voice', heart: 'Heart', move: 'Nod' }
  const chans = ['smile', 'voice', 'heart', 'move']
  const fig = crop('echo-fig', 'stage-echo', rect('echo', '.sg-fig', [84, 160, 749, 749]), [COL, CY, 600, CH], a, b, 0.2)
  const RX = fig.box[0] + fig.box[2] + 60 // the scores, right of the flower
  const RW = 1824 - RX
  const TX = 150 // where the bars start inside a row
  const TW = RW - TX - 110
  const bars = chans
    .map((ch, i) => `<div class="bar" id="echo-b${i + 1}" style="left:${RX}px;top:${CY + 78 + i * 96}px;width:${RW}px"><span class="bn">${names[ch]}</span><span class="track" style="left:${TX}px;width:${TW}px"><i class="fill ${ch}" id="echo-f${i + 1}" style="width:${TW}px"></i></span><span class="bv ${ch}" id="echo-v${i + 1}" style="left:${TX + TW + 22}px">50</span></div>`)
    .join('\n')
  scene('echo', `${phone('echo-phone', 96, [['phone-echo', a, b, 0.2]])}
<div class="h" id="echo-h" style="left:${COL}px">The echo: today, against your own usual.</div>
${fig.html}
<div class="q" id="echo-q" style="position:absolute;left:${RX}px;top:${CY + 6}px">Each reading, against your usual</div>
${bars}
<div class="usual" id="echo-u" style="left:${RX + TX + TW / 2}px;top:${CY + 84}px;height:${4 * 96 - 14}px"><b>50 · your usual</b></div>
<div class="total" id="echo-t" style="left:${RX}px;top:${CY + 500}px">Today's echo <b id="echo-tn">50</b><span> of 100</span></div>
<div class="verdict" id="echo-d" style="left:${RX}px;top:${CY + 486}px">A measurement,<br>not a diagnosis.</div>
${SRC('Live product capture · four channels read on this recording.')}`)
  enter('#echo-phone', a, { y: 50, dur: 0.8 })
  enter('#echo-h', a + 0.05, { y: 24, dur: 0.6 })
  enter('#echo-fig', a + 0.05, { x: 50, y: 0, dur: 0.7 })
  drift('#echo-fig-z', a, b, { to: 1.05 })
  enter('#echo-q', said('e1', 'Each') - 0.4, { y: 16 })
  enter('.bar', said('e1', 'Each') - 0.3, { x: 30, y: 0, dur: 0.6, stagger: 0.09 })
  fadeIn('#echo-u', said('e1', 'against') - 0.1, 0.5)
  chans.forEach((ch, i) => {
    const s = Math.round(comp[ch].strength)
    const t = said('e1', 'scored') + 0.25 + i * 0.16
    J(`tl.fromTo("#echo-f${i + 1}",{scaleX:0.5},{scaleX:${r2(s / 100)},duration:1.1,ease:"power3.out",transformOrigin:"0% 50%"},${r2(t)})`)
    count(`#echo-v${i + 1}`, t, s, { from: 50, dur: 1.1 })
  })
  enter('#echo-t', said('e1', 'so') - 0.2, { y: 18 })
  count('#echo-tn', said('e1', 'so'), Math.round(echo.strength), { from: 50, dur: 0.9 })
  J(`tl.to("#echo-t",{opacity:0,y:-14,duration:0.28,ease:"power2.in"},${r2(at.e2 - 0.35)})`)
  enter('#echo-d', at.e2 - 0.05, { y: 22, dur: 0.6 })
  appSound('snd-echo', 'echo', a, Math.min(b, a + 5), 0.2, { vol: 0.5, out: 0.6 })
}

// ================================================================ 6. the dose, and the same measure again
{
  const [a, b] = S.dose
  const here = r2(said('d1', 'Here,') - 0.2)
  const again = r2(at.d2 - 0.3)
  const learn = r2(said('d2', 'It') - 0.3) // "It keeps count of what followed"
  const BOX = [COL, CY, 820, CH]
  // the first bird is found in the breath between the two lines
  const birdAt = AT.bird ?? 7
  const doseFrom = Math.max(0, birdAt - (end.d1 + 0.35 - here))
  const learnedFrom = Math.max(0, (AT.learned ?? 3) + 0.4)
  const miniFrom = Math.max(0, lit2 - 1.3)
  const turn = crop('dose-turn', 'stage-dose', HEAD_PANEL('dose'), BOX, here, again, doseFrom + (cap.stageLag == null ? 1 : 0))
  const face2 = crop('dose-face', 'stage-mini', FACE('mini-laugh'), BOX, again, learn, miniFrom)
  const pair = crop('dose-pair', 'stage-after', pad(rect('again', '.sg-panel', [46, 349, 902, 535]), 0), BOX, learn, b, Math.max(0, (AT.learned ?? 3) - 1))
  const offered = /forest/i.test(P.offer ?? '') && !P.dosePickedFromHome
  const rx = (c) => c.box[0] + c.box[2] + 56
  scene('dose', `${phone('dose-phone', 96, [['phone-intro', a, here, 0.4], ['phone-dose', here, again, doseFrom], ['phone-mini', again, learn, Math.max(0, miniFrom - (cap.stageLag == null ? 1 : 0))], ['phone-after', learn, b, learnedFrom]])}
<div class="h" id="dose-h1" style="left:${COL}px">Then one small thing to do.</div>
<div class="h" id="dose-h2" style="left:${COL}px">Then the same measure again.</div>
<div class="read" id="dose-r0" style="left:${COL}px;top:${CY + 50}px;width:1160px"><div class="q">${offered ? "Today's offer" : 'One of four small things'}</div><div class="big2">The forest. Birds call from around you.<br>Turn your head to find them.</div><div class="lab">Three minutes, in your earbuds.</div></div>
${turn.html}
<div class="read" id="dose-r1" style="left:${rx(turn)}px;top:${CY + 40}px;width:${1824 - rx(turn)}px"><div class="q">Turn your head to the call</div><div class="num move"><span id="dose-n1">0</span><span class="u"> of 5</span></div><div class="unit move">birds found so far</div><div class="lab">The AirPods read which way the head turns.</div></div>
${face2.html}
<div class="read" id="dose-r2" style="left:${rx(face2)}px;top:${CY + 60}px;width:${1824 - rx(face2)}px"><div class="q">The same laugh, played again</div><div class="big2">Same clock.<br>Smile and heart,<br>20 seconds.</div></div>
${pair.html}
<div class="read" id="dose-r3" style="left:${rx(pair)}px;top:${CY + 60}px;width:${1824 - rx(pair)}px"><div class="q">Before and after</div><div class="big2">It keeps count of what followed.</div><div class="lab strong">One try. It can't yet tell what helped.</div></div>
${SRC('Live product capture · the same recorded smile both times; the difference here is measurement noise.')}`)
  enter('#dose-phone', a, { y: 50, dur: 0.8 })
  enter('#dose-h1', a + 0.05, { y: 24, dur: 0.6 })
  enter('#dose-r0', a + 0.3, { y: 22 })
  hide('#dose-r0', here)
  show('#dose-turn', here, { x: 50 })
  show('#dose-r1', here + 0.3, { y: 24 })
  if (AT.bird != null) {
    const hit = r2(here + birdAt - doseFrom)
    count('#dose-n1', hit, 1, { dur: 0.01 })
    pop('#dose-n1', hit, { to: 1.25 })
  }
  hide('#dose-turn,#dose-r1,#dose-h1', again)
  show('#dose-h2', again, { y: 24, dur: 0.6 })
  show('#dose-face', again, { x: 50 })
  show('#dose-r2', again + 0.25, { y: 24 })
  hide('#dose-face,#dose-r2', learn)
  show('#dose-pair', learn, { x: 50 })
  show('#dose-r3', learn + 0.25, { y: 24 })
  drift('#dose-turn-z', here, again, { to: 1.05 })
  drift('#dose-face-z', again, learn, { to: 1.05 })
  drift('#dose-pair-z', learn, b, { to: 1.04 })
  // the forest and the bird's call, then the laugh again
  appSound('snd-dose', 'dose', here, again, doseFrom, { vol: 0.5, in: 0.4, out: 0.4 })
  appSound('snd-mini', 'mini', again, learn, Math.max(0, miniFrom - (cap.stageLag == null ? 1 : 0)), { vol: 0.2, in: 0.2, out: 0.4 })
}

// ================================================================ 7. the clinic: who is drifting, and one tap
{
  const [a, b] = S.clinic
  const C = P.clinic ?? {}
  const up = r2(at.c2 - 0.25)
  const sim = r2(at.c3 - 0.25)
  const tap = r2(said('c3', 'One') - 0.5)
  const PAGE = [96, 214, 1728, 690]
  const head = rect('clinic-list', '.cl-head', [280, 92, 1360, 79])
  const lw = head[2] + 40
  const listRect = [head[0] - 20, Math.max(0, head[1] - 16), lw, Math.round((lw * PAGE[3]) / PAGE[2])]
  const list = crop('cl-list', 'clinic-list', listRect, PAGE, a, sim, 0.3, { center: true })
  const chart = crop('cl-chart', 'clinic-patient', pad(rect('clinic-patient-parts', '.cl-card', [280, 387, 1360, 529]), 10), PAGE, sim, tap, 1.2, { center: true })
  const phead = pad(rect('clinic-patient-parts', '.cl-phead', [280, 131, 1360, 226]), 16)
  const boost = crop('cl-boost', 'clinic-booster', phead, PAGE, tap, b, 0, { center: true })
  const row = rect('clinic-list', '.cl-row', null)
  const btn = cap.rects?.['clinic-patient']?.button
  scene('clinic', `<div class="h" id="cl-h1">The clinic gets numbers. Never video or sound.</div>
<div class="h" id="cl-h2">Go quiet or run low, and your name moves up.</div>
<div class="h" id="cl-h3">The latest ping, second by second.</div>
<div class="h" id="cl-h4">One tap asks them back in.</div>
<div class="pill" id="cl-sim">Simulated patients</div>
${list.html}
${chart.html}
${boost.html}
${SRC(`${esc(C.heading ?? 'The clinic list')} · ${C.synthetic ?? 24} simulated patients, made to show what the list would look like`)}`)
  enter('#cl-h1', a + 0.05, { y: 24, dur: 0.6 })
  enter('#cl-list', a, { y: 40, dur: 0.8 })
  fadeIn('#cl-sim', a + 0.4)
  hide('#cl-h1', up)
  show('#cl-h2', up, { y: 24, dur: 0.6 })
  // push in on the top of the list, where the names that need a call are
  if (row) {
    const ox = r2(((row[0] - listRect[0]) / listRect[2]) * 100)
    const oy = r2(((row[1] + row[3] * 0.6 - listRect[1]) / listRect[3]) * 100)
    J(`tl.fromTo("#cl-list-z",{scale:1},{scale:1.32,duration:1.4,ease:"power3.inOut",transformOrigin:"${ox}% ${oy}%"},${up})`)
  } else drift('#cl-list-z', a, sim, { to: 1.08 })
  hide('#cl-list,#cl-h2', sim)
  show('#cl-chart', sim, { dur: 0.35 })
  show('#cl-h3', sim, { y: 24, dur: 0.6 })
  pop('#cl-sim', said('c3', 'simulated'), { to: 1.18, origin: '100% 50%' })
  drift('#cl-chart-z', sim, tap, { to: 1.04 })
  hide('#cl-chart,#cl-h3', tap)
  show('#cl-boost', tap, { dur: 0.3 })
  show('#cl-h4', tap, { y: 24, dur: 0.6 })
  if (btn) {
    const ox = r2(((btn[0] + btn[2] / 2 - phead[0]) / phead[2]) * 100)
    const oy = r2(((btn[1] + btn[3] / 2 - phead[1]) / phead[3]) * 100)
    J(`tl.fromTo("#cl-boost-z",{scale:1},{scale:1.5,duration:1.2,ease:"power3.inOut",transformOrigin:"${ox}% ${oy}%"},${r2(tap + 0.1)})`)
  }
}

// ================================================================ 8. proof: what is checked so far
{
  const [a, b] = S.proof
  const mae = val.pulse.maeBpm
  const sens = Math.round(val.smile.sensitivityPct)
  const fp = Math.round(val.smile.falsePositivePct)
  const c2 = r2(at.p2 - 0.3)
  const c3 = r2(at.p3 - 0.3)
  scene('proof', `<div class="h" id="pf-h">What's checked so far.</div>
<div class="card" id="pf-1"><div class="q">Pulse from the phone's camera, against a finger sensor</div><div class="num huge heart"><span id="pf-n1">0.0</span><span class="u"> beats a minute off</span></div><div class="lab wide">on average, over ${val.pulse.subjects} people sitting still. It shows a number ${val.pulse.coveragePct}% of the time, and nothing when the signal is weak.</div><div class="fine">${esc(val.pulse.dataset)}</div></div>
<div class="card" id="pf-2"><div class="q">Smiles, in ${val.smile.clips} clips of ${val.smile.people} people</div><div class="two"><div><div class="num huge smile"><span id="pf-n2">0</span><span class="u"> of 100</span></div><div class="lab wide">clear smiles found</div></div><div><div class="num huge ember"><span id="pf-n3">0</span><span class="u"> of 100</span></div><div class="lab wide">neutral faces wrongly called a smile</div></div></div><div class="fine">Stock video, labelled by eye</div></div>
<div class="card" id="pf-3"><div class="q">Patients who have used it</div><div class="num huge" id="pf-n4">0</div><div class="lab wide strong" id="pf-next">Next: one clinic, 20 patients, next to the questionnaire.</div><div class="fine">Not tested yet: whether these readings follow depression. The AirPods' head and heart readings are not checked against a reference.</div></div>
${SRC('web/public/validation.json · the app shows the full table')}`)
  enter('#pf-h', a + 0.05, { y: 24, dur: 0.6 })
  enter('#pf-1', a + 0.2, { y: 40, dur: 0.8 })
  count('#pf-n1', said('p1', 'about') - 0.2, Math.round(mae * 10) / 10, { dur: 1.2, dp: 1 })
  J(`tl.to("#pf-1",{autoAlpha:0,x:-60,duration:0.3,ease:"power2.in"},${r2(c2 - 0.3)})`)
  show('#pf-2', c2, { x: 80, dur: 0.7 })
  count('#pf-n2', said('p2', '97') - 0.25, sens, { dur: 1.0 })
  count('#pf-n3', said('p2', '16') - 0.25, fp, { dur: 1.0 })
  J(`tl.to("#pf-2",{autoAlpha:0,x:-60,duration:0.3,ease:"power2.in"},${r2(c3 - 0.3)})`)
  show('#pf-3', c3, { x: 80, dur: 0.7 })
  enter('#pf-next', said('p3', 'Next:') - 0.2, { y: 22 })
}

// ================================================================ 9. close
{
  const [a, b] = S.close
  scene('close', `<div class="petals" id="end-p"><i class="smile" style="transform:rotate(0deg)"></i><i class="voice" style="transform:rotate(90deg)"></i><i class="heart" style="transform:rotate(180deg)"></i><i class="move" style="transform:rotate(270deg)"></i></div>
<div class="wordmark end" id="end-w">Vire</div>
<div class="endline" id="end-1">One minute a day, so your clinic knows when to call.</div>
<div class="endmeta" id="end-2">Junction 2026 · Beyond the Clinic · table A157</div>`)
  enter('#end-p', a + 0.1, { y: 0, scale: 0.5, dur: 1.0 })
  enter('#end-w', a + 0.1, { y: 40, dur: 0.9 })
  enter('#end-1', said('z1', 'One') - 0.2, { y: 24 })
  enter('#end-2', end.z1 - 0.4, { y: 14 })
  J(`tl.to("#s-close",{opacity:0,duration:0.7,ease:"power2.in"},${r2(TOTAL - 0.75)})`)
  void b
}

// ---------------------------------------------------------------- between scenes: a short fade up
for (const id of ['name', 'why', 'min', 'echo', 'dose', 'clinic', 'proof', 'close']) J(`tl.fromTo("#s-${id}",{opacity:0},{opacity:1,duration:0.25,ease:"power1.out"},${S[id][0]})`)

// ---------------------------------------------------------------- captions: the narration, a few words at a time
const caps = []
for (const [id] of ORDER) {
  const ws = VO[id].words
  let group = []
  const groups = []
  const flush = () => {
    if (group.length) groups.push(group)
    group = []
  }
  for (const w of ws) {
    const chars = group.reduce((n, x) => n + x.text.length + 1, 0)
    const last = group.at(-1)
    if (last && (/[.?!:]$/.test(last.text) || (/,$/.test(last.text) && group.length >= 3) || chars + w.text.length > 30 || group.length >= 6)) flush()
    group.push(w)
  }
  flush()
  groups.forEach((g, i) => {
    const s = r2(Math.max(0.12, at[id] + g[0].start - 0.06))
    const next = groups[i + 1]
    const e = r2(next ? at[id] + next[0].start - 0.06 : at[id] + g.at(-1).end + 0.3)
    caps.push({ s, e, text: g.map((x) => x.text).join(' ') })
  })
}
const capHtml = caps.map((c, i) => `<div class="cap" id="cap-${i}"><span>${esc(c.text)}</span></div>`).join('\n')
caps.forEach((c, i) => {
  J(`tl.set("#cap-${i}",{autoAlpha:1},${c.s})`)
  J(`tl.set("#cap-${i}",{autoAlpha:0},${c.e})`)
})

// ---------------------------------------------------------------- sound: narration, the score under it
for (const [id] of ORDER) audio(`vo-${id}`, `assets/vo/${id}.mp3`, at[id], VO[id].dur, { vol: 1 })
audio('music', 'assets/vire-score.mp3', 0, TOTAL, { vol: 0.13, in: 0.6, out: 2.2 })

const page = `<!doctype html>
<!-- Written by film/scripts/build.mjs from the capture, the narration and web/public/validation.json. Don't edit: run film/render.sh vN. -->
<html lang="en" data-resolution="landscape">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
@font-face{font-family:'Fraunces';font-style:normal;font-weight:100 900;src:url('assets/fonts/fraunces-latin.woff2') format('woff2')}
@font-face{font-family:'Fraunces';font-style:italic;font-weight:100 900;src:url('assets/fonts/fraunces-italic-latin.woff2') format('woff2')}
@font-face{font-family:'Vire Sans';font-style:normal;font-weight:100 900;src:url('assets/fonts/inter-latin.woff2') format('woff2')}
:root{--bg:#14110d;--bg2:#1f1b15;--line:#3a3229;--ink:#f3ece0;--ink2:#a79f90;--ember:#e4572e;--smile:#e9a23b;--voice:#35b3a3;--heart:#e0596b;--move:#8794ea}
*{box-sizing:border-box}
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#14110d}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:#14110d;color:var(--ink);font-family:'Vire Sans',sans-serif;font-weight:450}
#bg{position:absolute;inset:0;background:radial-gradient(1300px 900px at 74% 12%,#2b2219 0,#14110d 64%)}
.scene{position:absolute;inset:0;opacity:0;visibility:hidden}
.scene.first{opacity:1;visibility:visible}
.h{position:absolute;left:96px;top:50px;max-width:1300px;font-family:'Fraunces',serif;font-weight:540;font-size:60px;line-height:1.1;letter-spacing:-0.018em}
.warm{color:var(--smile)}.ember{color:var(--ember)}.smile{color:var(--smile)}.voice{color:var(--voice)}.heart{color:var(--heart)}.move{color:var(--move)}
.src{position:absolute;left:96px;right:96px;bottom:20px;font-size:20px;line-height:1.3;color:#8f8676;letter-spacing:.005em}
.crop{position:absolute;overflow:hidden;border-radius:20px;background:#0f0d0a;box-shadow:0 30px 90px rgba(0,0,0,.55),0 0 0 1px #3a3229}
.zoom{position:absolute;inset:0}
.crop video{position:absolute;max-width:none}
.tag{position:absolute;left:16px;top:16px;padding:7px 16px 9px;border-radius:999px;background:rgba(20,17,13,.88);box-shadow:0 0 0 1px #4a4136;color:var(--ink);font-size:22px;font-weight:600}
.phone{position:absolute;overflow:hidden;border-radius:46px;background:#0b0a08;box-shadow:0 34px 90px rgba(0,0,0,.6),0 0 0 8px #26211b,0 0 0 10px #40382d}
.phone video{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
.read{position:absolute}
.q{font-size:30px;line-height:1.25;color:var(--ink2);margin-bottom:14px}
.num{font-family:'Fraunces',serif;font-weight:600;font-size:150px;line-height:1;letter-spacing:-0.035em;font-variant-numeric:tabular-nums;white-space:nowrap}
.num.huge{font-size:230px}
.num .u{font-size:.3em;letter-spacing:-0.01em;font-weight:500;color:var(--ink)}
.unit{font-family:'Fraunces',serif;font-weight:500;font-size:44px;line-height:1.1;margin-top:6px}
.lab{font-size:28px;line-height:1.35;color:var(--ink2);margin-top:18px}
.lab.wide{font-size:36px;max-width:1300px;color:var(--ink)}
.lab.strong,.strong{color:var(--ink);font-weight:600}
.note{position:absolute;font-size:27px;line-height:1.4;color:var(--ink2)}
.big{position:absolute;font-family:'Fraunces',serif;font-weight:520;font-size:74px;line-height:1.1;letter-spacing:-0.02em;white-space:nowrap}
.big.dim{color:var(--smile)}
.big2{font-family:'Fraunces',serif;font-weight:520;font-size:54px;line-height:1.14;letter-spacing:-0.015em}
.wordmark{position:absolute;left:680px;top:120px;font-family:'Fraunces',serif;font-weight:600;font-size:270px;line-height:1;letter-spacing:-0.045em}
.tagline{position:absolute;font-family:'Fraunces',serif;font-weight:540;font-size:44px;line-height:1.1;letter-spacing:-0.015em;white-space:nowrap}
#why-n{position:absolute;left:88px;top:310px;font-size:330px}
.rail{position:absolute;display:flex;gap:14px}
.chip{display:inline-flex;align-items:center;gap:12px;padding:7px 22px 8px 10px;border:2px solid var(--line);border-radius:999px;font-size:27px;font-weight:600;color:var(--ink2)}
.chip i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.1);font-size:20px}
.bar{position:absolute;height:80px}
.bar .bn{position:absolute;left:0;top:12px;font-family:'Fraunces',serif;font-weight:540;font-size:44px}
.bar .track{position:absolute;top:22px;height:36px;border-radius:18px;background:#221d17;overflow:hidden}
.bar .fill{position:absolute;left:0;top:0;height:100%;border-radius:18px}
.fill.smile{background:var(--smile)}.fill.voice{background:var(--voice)}.fill.heart{background:var(--heart)}.fill.move{background:var(--move)}
.bar .bv{position:absolute;top:4px;font-family:'Fraunces',serif;font-weight:600;font-size:58px;font-variant-numeric:tabular-nums}
.usual{position:absolute;width:0;border-left:3px dashed #f3ece0}
.usual b{position:absolute;left:-150px;width:300px;top:-38px;text-align:center;font-size:24px;font-weight:600;color:var(--ink);white-space:nowrap}
.total{position:absolute;font-size:38px;color:var(--ink2);white-space:nowrap}
.total b{font-family:'Fraunces',serif;font-weight:600;font-size:92px;color:var(--ink);padding:0 10px 0 16px;font-variant-numeric:tabular-nums}
.verdict{position:absolute;font-family:'Fraunces',serif;font-weight:560;font-size:60px;line-height:1.08;letter-spacing:-0.02em;white-space:nowrap}
.pill{position:absolute;right:96px;top:62px;padding:9px 24px 11px;border-radius:999px;background:var(--ember);color:#14110d;font-size:28px;font-weight:700;white-space:nowrap}
.pill.sm{right:auto;font-size:22px;padding:6px 18px 8px}
.card{position:absolute;left:96px;top:200px;width:1728px;height:700px;padding:50px 64px;border-radius:28px;background:#1c1813;box-shadow:0 0 0 1px #3a3229,0 30px 90px rgba(0,0,0,.45);opacity:0;visibility:hidden}
#pf-1{visibility:visible}
.card .q{font-size:38px;color:var(--ink)}
.card .two{display:flex;gap:90px}
.card .fine{position:absolute;left:64px;right:64px;bottom:36px;font-size:25px;line-height:1.35;color:var(--ink2)}
.wordmark.end{left:0;right:0;top:330px;text-align:center;font-size:250px}
.endline{position:absolute;left:0;right:0;top:640px;text-align:center;font-family:'Fraunces',serif;font-weight:500;font-size:60px;letter-spacing:-0.015em}
.endmeta{position:absolute;left:0;right:0;top:752px;text-align:center;font-size:30px;color:var(--ink2)}
.petals{position:absolute;left:885px;top:150px;width:150px;height:150px}
.petals i{position:absolute;left:50px;top:0;width:50px;height:78px;border-radius:50% 50% 50% 50%/62% 62% 38% 38%;transform-origin:25px 75px;opacity:.92}
.petals i.smile{background:var(--smile)}.petals i.voice{background:var(--voice)}.petals i.heart{background:var(--heart)}.petals i.move{background:var(--move)}
#caps{position:absolute;inset:0;pointer-events:none}
.cap{position:absolute;left:0;right:0;bottom:84px;text-align:center;opacity:0;visibility:hidden}
.cap span{display:inline-block;padding:8px 24px 11px;border-radius:14px;background:rgba(12,10,8,.86);color:var(--ink);font-size:40px;font-weight:600;line-height:1.2;letter-spacing:-0.005em}
#min-wide,#min-p1,#min-p2,#min-p3,#min-p4,.read[id^="min-r"],#dose-turn,#dose-face,#dose-pair,#dose-r1,#dose-r2,#dose-r3,#dose-h2,#cl-h2,#cl-h3,#cl-h4,#cl-chart,#cl-boost{opacity:0;visibility:hidden}
#min-wide{opacity:1;visibility:visible}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
<div id="bg"></div>
${body.join('\n\n')}

<div id="caps" data-track-kind="captions">
${capHtml}
</div>

${sound.join('\n')}
</div>
<script>
window.__timelines = window.__timelines || {}
const tl = gsap.timeline({ paused: true })
${js.join('\n')}
window.__timelines.main = tl
</script>
</body>
</html>
`
fs.writeFileSync(path.join(film, 'index.html'), page)
console.log(`film: ${TOTAL}s, ${caps.length} captions; scenes ` + Object.entries(S).map(([k, [a, b]]) => `${k} ${a}-${b}`).join(', '))
console.log('numbers from the capture:', JSON.stringify({ ...N, faceLit: lit, faceLit2: lit2, stageLag: cap.stageLag ?? 'not measured', strengths: Object.fromEntries(Object.entries(comp).map(([k, c]) => [k, c.strength])), echo: echo.strength, phoneUpload: { laughToSmileS: (F.smile?.latencyMs ?? 0) / 1000, voiceSemitones: F.voice?.f0SdSemitones, nodDegS: F.move?.nodPeakVelDegS, heartSwingBpm: F.heart?.swingBpm }, clinic: P.clinic?.heading }))
