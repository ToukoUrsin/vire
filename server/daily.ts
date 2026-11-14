import { appendFile, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

// Each one asks for a sentence or two, so the voice has something to move over. None asks about how the
// person is, and none asks for anything that names them.
export const DAILY_QUESTIONS = [
  'Describe the view from the nearest window.',
  'What would you cook for a friend tonight?',
  'Tell me about a place you like to walk.',
  'What would you do with a free afternoon?',
  'Describe your ideal breakfast.',
  'What would you show a visitor in your town?',
  'Tell me about a book or a film you like.',
  'What would you put on a pizza, and why?',
  'What do you like to do on a slow morning?',
  'Describe the room you are in.',
  'Tell me how you make your coffee or tea.',
  'What is the best meal you remember?',
  'Describe a place by the water that you know.',
  'What would you pack for a day trip?',
  'Tell me about an animal you like.',
  'What does your favourite season look like?',
  'Describe a street you know well.',
  'What music would you put on right now, and why?',
  'Tell me about something you made with your hands.',
  'What would you plant in a garden?',
  'Describe the weather outside today.',
  'What game did you like as a child?',
  'Tell me about a trip you would like to take.',
  'What is in your bag or your pockets right now?',
  'Describe a meal you can cook without a recipe.',
  'What would you do on a rainy Sunday?',
  'Tell me about a teacher you remember.',
  'What is the nicest building you know?',
  'Describe your favourite chair or corner.',
  'What would you bring to a picnic?',
  'Tell me about a sound you like.',
  'Describe the last thing you bought.',
  'What could you teach someone in ten minutes?',
  'Tell me about a smell that takes you somewhere.',
  'What is the first thing you do when you get home?',
  'Describe a walk you have done many times.',
] as const
const FALLBACK_QUESTIONS = [
  'What’s one thing you’re looking forward to?',
  'Tell me about something small that went well lately.',
  'What did you eat today, and how was it?',
] as const

export const LAUGH_PROMPTS = [
  'About 10 seconds of warm, natural contagious laughter from one person close to the microphone, no music, no words, no background noise.',
  'About 10 seconds of two close friends laughing together naturally, overlapping contagious laughter, no speech, no music, clean recording.',
  'About 10 seconds of a small group laughing freely in a cosy room, genuine varied laughter, no words, no music, close and warm.',
  'About 10 seconds of a child giggling, then an adult joining with warm contagious laughter, no speech, no music, close microphone.',
  'About 10 seconds of one person trying to hold back a laugh and then laughing openly, natural breaths, no words, no music.',
  'About 10 seconds of three friends breaking into bright contagious laughter, natural pauses and bursts, no conversation, no music.',
  'About 10 seconds of a gentle chuckle growing into full warm laughter from one person, close microphone, no words, no music.',
  'About 10 seconds of two people laughing after a silly surprise, light and contagious, no speech, no music, clean close recording.',
] as const

export type DailyKind = 'laugh' | 'question'
type Source = 'generated' | 'fallback'
export interface DailyAssetStatus {
  source: Source
  generatedAt: string | null
  callMs: number | null
  endpoint: string | null
  model: string | null
  seconds: number | null
  file: string
}
export interface DailyStatus {
  date: string
  question: string
  laugh: DailyAssetStatus
  questionAudio: DailyAssetStatus
}

const DAILY_DIR = process.env.VIRE_DAILY_DIR || '/bulk2/runs/depression/daily/'
const LOG = process.env.VIRE_ELEVEN_LOG || '/bulk2/runs/depression/elevenlabs/calls.jsonl'
const KEY = process.env.ELEVENLABS_API_KEY
const VOICE = 'EXAVITQu4vr4xnSDxMaL'
const SFX_MODEL = 'eleven_text_to_sound_v2'
const TTS_MODEL = 'eleven_multilingual_v2'
const api = 'https://api.elevenlabs.io'
// The container ships only the built site (web/dist); a checkout has both.
const shippedDir = [new URL('../web/dist/audio/', import.meta.url).pathname, new URL('../web/public/audio/', import.meta.url).pathname].find((d) => existsSync(d)) ?? new URL('../web/public/audio/', import.meta.url).pathname
const generation = new Map<string, Promise<void>>()
const generatedMeta = new Map<string, { at: string; callMs: number; seconds: number; endpoint: string; model: string }>()

function helsinkiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
function dayIndex(date: string): number {
  return Math.max(0, Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000))
}
function paths(date: string) {
  // The question file carries a mark of its own text, so a reworded question is never played with the old voice.
  const mark = Bun.hash(DAILY_QUESTIONS[dayIndex(date) % DAILY_QUESTIONS.length]!).toString(36).slice(0, 6)
  return { laugh: join(DAILY_DIR, `laugh-${date}.mp3`), question: join(DAILY_DIR, `question-${date}-${mark}.mp3`) }
}
function shipped(kind: DailyKind, date: string): string {
  return kind === 'laugh' ? join(shippedDir, `laugh-${(dayIndex(date) % 3) + 1}.mp3`) : join(shippedDir, `vo-speak-${(dayIndex(date) % FALLBACK_QUESTIONS.length) + 1}.mp3`)
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}
async function logCall(endpoint: string, model: string, asked: { characters?: number; seconds?: number }, started: number, bytes: number, error?: string) {
  try {
    await mkdir(dirname(LOG), { recursive: true })
    await appendFile(LOG, `${JSON.stringify({ time: new Date().toISOString(), endpoint, model, ...asked, milliseconds: Date.now() - started, bytes, ok: !error, ...(error ? { error } : {}) })}\n`)
  } catch { /* logging must not break playback */ }
}
async function inspect(path: string, min: number, max: number): Promise<{ duration: number; bytes: number }> {
  const file = Bun.file(path)
  const bytes = file.size
  const p = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(p.stdout).text()
  const duration = Number(out.trim())
  if (!Number.isFinite(duration) || duration < min || duration > max || bytes < 256) throw new Error('audio duration or size check failed')
  // A silent file has no measurable peak. This also makes malformed MP3s fail before they are served.
  const v = Bun.spawn(['ffmpeg', '-v', 'info', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], { stdout: 'pipe', 'stderr': 'pipe' })
  const err = await new Response(v.stderr).text()
  const peak = Number.parseFloat(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(err)?.[1] ?? '-Infinity')
  if (!Number.isFinite(peak) || peak < -55) throw new Error('audio is silent')
  return { duration, bytes }
}
async function normalise(input: Uint8Array, path: string, min: number, max: number): Promise<{ duration: number; bytes: number }> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await Bun.write(tmp, input)
  const out = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', '-b:a', '128k', path], { stdout: 'pipe', stderr: 'pipe' })
  const code = await out.exited
  try { await unlink(tmp) } catch { /* ignore */ }
  if (code !== 0) throw new Error('ffmpeg normalisation failed')
  return inspect(path, min, max)
}
async function request(endpoint: string, model: string, body: Record<string, unknown>, asked: { characters?: number; seconds?: number }): Promise<Uint8Array> {
  if (!KEY) throw new Error('ELEVENLABS_API_KEY is not set')
  const started = Date.now()
  try {
    const r = await fetch(`${api}${endpoint}`, { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}`)
    const bytes = new Uint8Array(await r.arrayBuffer())
    await logCall(endpoint, model, asked, started, bytes.byteLength)
    return bytes
  } catch (e) {
    await logCall(endpoint, model, asked, started, 0, String(e instanceof Error ? e.message : e))
    throw e
  }
}
async function generate(kind: DailyKind, date: string): Promise<void> {
  const key = `${kind}:${date}`
  if (generation.has(key)) return generation.get(key)!
  const p = (async () => {
    const file = paths(date)[kind]
    if (await exists(file) || !KEY) return
    const i = kind === 'laugh' ? dayIndex(date) % LAUGH_PROMPTS.length : dayIndex(date) % DAILY_QUESTIONS.length
    const started = Date.now()
    if (kind === 'laugh') {
      const endpoint = '/v1/sound-generation?output_format=mp3_44100_128'
      const raw = await request(endpoint, SFX_MODEL, { text: LAUGH_PROMPTS[i]!, duration_seconds: 10, prompt_influence: 0.45, model_id: SFX_MODEL }, { seconds: 10 })
      const checked = await normalise(raw, file, 8, 12)
      generatedMeta.set(key, { at: new Date().toISOString(), callMs: Date.now() - started, seconds: checked.duration, endpoint, model: SFX_MODEL })
    } else {
      const endpoint = `/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`
      const text = DAILY_QUESTIONS[i]!
      const raw = await request(endpoint, TTS_MODEL, { text, model_id: TTS_MODEL, voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15, speed: 0.92 } }, { characters: text.length })
      const checked = await normalise(raw, file, 1, 20)
      generatedMeta.set(key, { at: new Date().toISOString(), callMs: Date.now() - started, seconds: checked.duration, endpoint, model: TTS_MODEL })
    }
  })().catch(() => {}).finally(() => generation.delete(key))
  generation.set(key, p)
  return p
}
async function status(kind: DailyKind, date: string): Promise<DailyAssetStatus> {
  const file = paths(date)[kind]
  const m = generatedMeta.get(`${kind}:${date}`)
  let generatedAt = m?.at ?? null
  let seconds = m?.seconds ?? null
  if (!generatedAt) {
    try { generatedAt = new Date((await stat(file)).mtimeMs).toISOString() } catch { /* file disappeared */ }
  }
  if (seconds == null) {
    try { seconds = (await inspect(file, kind === 'laugh' ? 8 : 1, kind === 'laugh' ? 12 : 20)).duration } catch { /* status still useful */ }
  }
  return { source: 'generated', generatedAt, callMs: m?.callMs ?? null, endpoint: m?.endpoint ?? (kind === 'laugh' ? '/v1/sound-generation' : `/v1/text-to-speech/${VOICE}`), model: m?.model ?? (kind === 'laugh' ? SFX_MODEL : TTS_MODEL), seconds, file }
}
export async function dailyStatus(now = new Date()): Promise<DailyStatus> {
  const date = helsinkiDate(now)
  const p = paths(date)
  const generatedQuestion = DAILY_QUESTIONS[dayIndex(date) % DAILY_QUESTIONS.length]!
  // Generation is deliberately fire-and-forget. A request must always get either
  // today's file or a shipped clip immediately, never wait on ElevenLabs.
  void generate('laugh', date)
  void generate('question', date)
  const laughExists = await exists(p.laugh)
  const questionExists = await exists(p.question)
  const question = questionExists ? generatedQuestion : FALLBACK_QUESTIONS[dayIndex(date) % FALLBACK_QUESTIONS.length]!
  return {
    date,
    question,
    laugh: laughExists ? await status('laugh', date) : { source: 'fallback', generatedAt: null, callMs: null, endpoint: null, model: null, seconds: null, file: shipped('laugh', date) },
    questionAudio: questionExists ? await status('question', date) : { source: 'fallback', generatedAt: null, callMs: null, endpoint: null, model: null, seconds: null, file: shipped('question', date) },
  }
}
export async function dailyAudio(kind: DailyKind, now = new Date()): Promise<{ body: Uint8Array; status: DailyAssetStatus }> {
  const s = await dailyStatus(now)
  const a = kind === 'laugh' ? s.laugh : s.questionAudio
  return { body: new Uint8Array(await readFile(a.file)), status: a }
}
export function dailyDate(now = new Date()) { return helsinkiDate(now) }
export function ensureDaily() { void dailyStatus().catch(() => {}) }
export const dailyForTest = { inspect, normalise, paths, helsinkiDate, status }
