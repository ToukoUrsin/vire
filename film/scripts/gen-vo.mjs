#!/usr/bin/env node
// The film's narration, one file per line, with the time of every word (for the burned-in captions).
//   hsec exec --only ELEVENLABS_API_KEY -- node film/scripts/gen-vo.mjs
// Only lines whose text changed are generated again. Every sentence here is in pitch/claims.md or says what the
// capture shows; change a claim there first. film/scripts/build.mjs places the lines back to back and cuts the
// picture on their words, so a changed line needs nothing else.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const out = path.join(root, 'assets', 'vo')
fs.mkdirSync(out, { recursive: true })
const voice = 'EXAVITQu4vr4xnSDxMaL'
const settings = { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.0 }
export const LINES = [
  ['h1', 'This phone just played a laugh. Then it timed the smile that came back.'],
  ['h2', 'This is Vire. TMS is magnetic brain stimulation for depression: 20 to 30 clinic visits. Vire checks you for one minute a day at home.'],
  ['h3', 'Within a year, TMS stops working for about half the people it helped. Vire shows the clinic who to call back.'],
  ['m1', 'The minute is four small things. A nod: how big, how quick?'],
  ['m2', 'The laugh: how fast does the smile come, and how long does it stay?'],
  ['m3', 'One sentence out loud: how much does your voice rise and fall?'],
  ['m4', 'Two slow breaths: how far does your heart rate swing?'],
  ['e1', 'Then the echo. Each reading is scored against your own usual, so 50 is a normal day.'],
  ['e2', "It's a measurement, not a diagnosis."],
  ['d1', 'After the echo, Vire offers one small thing. Here, a forest in your ears: turn your head to find the birds.'],
  ['d2', "Then it plays the laugh again and measures again. It keeps count of what followed. It can't yet tell what helped."],
  ['c1', 'The clinic gets numbers, never video or sound.'],
  ['c2', 'Three low days in a row, or you go quiet, and your name moves up.'],
  ['c3', 'These patients are simulated. This is what slipping would look like. One tap asks them back in.'],
  ['p1', "What's checked so far: the camera reads pulse about one beat a minute off a finger sensor, on 16 people sitting still."],
  ['p2', 'It finds 97 of 100 clear smiles, and wrongly sees a smile in 16 of 100 neutral faces.'],
  ['p3', 'No patient has used it yet. Next: one clinic, 20 patients, next to the questionnaire.'],
  ['z1', 'Vire. One minute a day, so your clinic knows when to call.'],
]

/** character timings -> words (split on spaces) */
function words(al) {
  const ws = []
  let cur = null
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) ws.push(cur)
      cur = null
      return
    }
    if (!cur) cur = { text: '', start: al.character_start_times_seconds[i], end: 0 }
    cur.text += ch
    cur.end = al.character_end_times_seconds[i]
  })
  if (cur) ws.push(cur)
  return ws.map((w) => ({ text: w.text, start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 }))
}

const key = process.env.ELEVENLABS_API_KEY
const all = {}
for (let i = 0; i < LINES.length; i++) {
  const [id, text] = LINES[i]
  const file = path.join(out, `${id}.mp3`)
  const side = path.join(out, `${id}.json`)
  let rec = fs.existsSync(side) && fs.existsSync(file) ? JSON.parse(fs.readFileSync(side, 'utf8')) : null
  if (!rec || rec.text !== text) {
    if (!key) throw new Error(`line ${id} changed: run through hsec exec --only ELEVENLABS_API_KEY`)
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: settings,
        previous_text: LINES[i - 1]?.[1],
        next_text: LINES[i + 1]?.[1],
      }),
    })
    if (!res.ok) throw new Error(`TTS ${id} ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    fs.writeFileSync(file, Buffer.from(j.audio_base64, 'base64'))
    const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout)
    rec = { text, dur: Math.round(dur * 1000) / 1000, words: words(j.alignment) }
    fs.writeFileSync(side, JSON.stringify(rec))
    console.log(id, rec.dur, text)
  }
  all[id] = rec
}
fs.writeFileSync(path.join(out, 'vo.js'), `window.__VO = ${JSON.stringify(all)}\n`)
console.log('lines', LINES.length, 'speech', Object.values(all).reduce((s, r) => s + r.dur, 0).toFixed(1), 's')
