// LLM polish for three short texts: the person's message, the clinician's one-line reason, the clinician summary.
// Claude Opus through the seat pool only (CLIProxy on 127.0.0.1:8317, key in env CLIPROXY_API_KEY).
// Every call has a deterministic fallback: the server behaves the same with the model unreachable, only plainer.
import Anthropic from '@anthropic-ai/sdk'
import { cacheGet, cachePut } from './db'

export type PolishKind = 'patient' | 'reason' | 'summary'

const SEAT_POOL = 'http://127.0.0.1:8317'
const MODEL = 'claude-opus-5-5'
const VERSION = 'v6' // bump to drop cached texts after a prompt change
const CALL_TIMEOUT_MS = 9000 // background warm-up may take longer; nobody is waiting on it

const key = process.env.CLIPROXY_API_KEY
const client =
  key && process.env.VIRE_LLM !== 'off'
    ? new Anthropic({ apiKey: key, authToken: null, baseURL: SEAT_POOL, timeout: CALL_TIMEOUT_MS, maxRetries: 0 })
    : null

const RULES =
  'This is a measured loop, not a diagnosis. Never mention depression, relapse, illness, disorder, symptoms or risk, and never guess at causes. ' +
  'Use only what is in the input: do not add numbers, events or interpretation. Output only the text, no quotes, no preamble.'

const SYSTEM: Record<PolishKind, string> = {
  patient:
    'You write the one short message a person sees after their daily 60-second check-in ("ping") in the Vire app, which they use at home after TMS treatment. ' +
    'Input is JSON: status, strength (0-100, 50 = their own usual), one note per channel, and a draft. ' +
    'Rewrite the draft as one or two warm, plain sentences in second person, at most 28 words. Keep the meaning of the draft and weave in at most two of the notes in everyday words. ' +
    'No numbers unless the draft has them, no exclamation marks, no emoji, no questions, no advice the draft does not already give, nothing alarming. ' +
    RULES,
  reason:
    "You write the one-line reason shown beside a patient in a clinician's call list, in a home-monitoring tool used after TMS treatment. " +
    'Input is JSON facts plus a draft line. Rewrite the draft as one specific line of at most 24 words for a busy clinician, in natural wording (not telegraphic): lead with what changed, keep every figure and the timing of the last day from the draft. ' +
    'Name the signals only with the words the draft uses (for AirPods days: head movement, head down, walks, heart rate; for a camera check: smile, voice, heart, nod). Never introduce a word the draft does not use for them. Refer to the patient as "they". No recommendation, no full stop at the end. ' +
    RULES,
  summary:
    "You write the summary at the top of a patient's page for a clinician, in a home-monitoring tool used after TMS treatment. " +
    'Input is JSON facts plus a draft. Rewrite the draft as plain prose of at most 3 sentences and 70 words (join clauses with semicolons if you need to): the course, where their last day sits against their usual and how it got there, and what has helped at home. ' +
    'Name the signals only with the words the draft uses, and keep its word for what was measured (days with AirPods in, or camera checks). ' +
    'Keep every figure from the draft and keep the placeholder [NAME] exactly as written. Refer to the patient as "they". No recommendation. ' +
    RULES,
}
const MAX_CHARS: Record<PolishKind, number> = { patient: 230, reason: 210, summary: 640 }
const OLD_WORDS = [/\becho/i, /\bping/i, /signature/i, /\bchannel/i, /\bsmil/i, /\bvoice/i, /\bnod\b/i, /\bcamera/i, /airpods/i]
const BANNED = /depress|diagnos|relaps|suicid|disorder|symptom|illness|\bpatient is at risk\b/i

const hashOf = (kind: PolishKind, input: string) => new Bun.CryptoHasher('sha256').update(`${VERSION}|${MODEL}|${kind}|${input}`).digest('hex')
const numbers = (s: string) => s.replace(/−/g, '-').match(/\d+(?:\.\d+)?/g) ?? []

/** The model's text is only used if it is short, clean and adds no number that was not in the input. */
export function acceptable(kind: PolishKind, text: string, input: string): boolean {
  if (!text || text.length > MAX_CHARS[kind] || text.includes('\n\n') || BANNED.test(text)) return false
  if (kind === 'patient' && /[!?]/.test(text)) return false
  if (kind === 'summary' && (text.match(/[.!?](\s|$)/g) ?? []).length > 3) return false
  if (kind === 'reason' && text.includes('\n')) return false
  // clinic texts: the model must not bring back the camera-check words (or AirPods) where the draft did not use them
  const draft = (() => {
    try {
      return String((JSON.parse(input) as { draft?: unknown }).draft ?? input)
    } catch {
      return input
    }
  })()
  if (kind !== 'patient') for (const w of OLD_WORDS) if (w.test(text) && !w.test(draft)) return false
  const known = new Set(numbers(input))
  return numbers(text).every((n) => known.has(n))
}

// circuit breaker: a slow or dead model must not add seconds to every ping
let failures = 0
let closedUntil = 0
const inflight = new Map<string, Promise<string | null>>()
let active = 0
const waiting: (() => void)[] = []

async function call(kind: PolishKind, input: string): Promise<string | null> {
  if (!client || Date.now() < closedUntil) return null
  if (active >= 2) await new Promise<void>((go) => waiting.push(go))
  active++
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      thinking: { type: 'disabled' }, // a rewrite of one sentence: speed matters more than depth
      output_config: { effort: 'low' },
      system: SYSTEM[kind],
      messages: [{ role: 'user', content: input }],
    })
    failures = 0
    if (res.stop_reason !== 'end_turn') return null // refusal or cut off: the template stands
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
      .replace(/^["“]|["”]$/g, '')
      .trim()
    return text
  } catch (err) {
    if (++failures >= 3) closedUntil = Date.now() + 45_000
    if (err instanceof Anthropic.APIConnectionTimeoutError) console.warn(`[llm] ${kind}: timed out`)
    else if (err instanceof Anthropic.RateLimitError) console.warn(`[llm] ${kind}: rate limited`)
    else if (err instanceof Anthropic.APIConnectionError) console.warn(`[llm] ${kind}: seat pool unreachable`)
    else if (err instanceof Anthropic.APIError) console.warn(`[llm] ${kind}: ${err.status} ${err.message}`)
    else console.warn(`[llm] ${kind}:`, err)
    return null
  } finally {
    active--
    waiting.shift()?.()
  }
}

function start(kind: PolishKind, input: string, hash: string, fallback: string): Promise<string | null> {
  let p = inflight.get(hash)
  if (!p) {
    p = call(kind, input)
      .then((text) => {
        if (text == null) return null // transient: try again another time
        const out = acceptable(kind, text, input) ? text : fallback
        cachePut(hash, out)
        return out
      })
      .finally(() => inflight.delete(hash))
    inflight.set(hash, p)
  }
  return p
}

const inputOf = (facts: unknown, fallback: string) => JSON.stringify({ facts, draft: fallback })

/** Cached polished text if there is one, else the fallback. Never waits. */
export function polished(kind: PolishKind, facts: unknown, fallback: string): string {
  return cacheGet(hashOf(kind, inputOf(facts, fallback))) ?? fallback
}

/** Polished text, waiting at most `ms` for the model; the fallback on any failure or delay. */
export async function polish(kind: PolishKind, facts: unknown, fallback: string, _ms = 0): Promise<string> {
  const input = inputOf(facts, fallback)
  const hash = hashOf(kind, input)
  const hit = cacheGet(hash)
  if (hit) return hit
  if (!client || Date.now() < closedUntil) return fallback
  // The phone and clinic APIs are latency-sensitive. The deterministic draft is the response;
  // Opus fills the cache for a later read without holding this request open.
  void start(kind, input, hash, fallback)
  return fallback
}

/** Start polishing in the background so a later request finds it cached. */
export function warm(kind: PolishKind, facts: unknown, fallback: string): void {
  if (!client || Date.now() < closedUntil) return
  const input = inputOf(facts, fallback)
  const hash = hashOf(kind, input)
  if (!cacheGet(hash)) void start(kind, input, hash, fallback)
}

export const llmStatus = () => ({ enabled: !!client, model: MODEL, open: Date.now() >= closedUntil, failures })
