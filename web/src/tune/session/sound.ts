export type SoundKind = 'breathe' | 'scan' | 'walk'
export type SoundStage = 'settle' | 'deep' | 'rest'

export interface SoundRequest {
  kind: SoundKind
  stage: SoundStage
  pace: number
  calm: number
  person?: string
  waitMs?: number
  /** Pass the context used by the session so decoding follows the phone's output device. */
  audioContext?: AudioContextLike
}
export interface SoundInfo {
  id: string
  url: string
  seconds: number
  made: 'live' | 'set'
  model: string
  ms?: number
  live?: boolean
}
export interface SoundManifest {
  live: boolean
  beds: Array<SoundInfo & { input?: { kind: SoundKind; stage: SoundStage; pace: number; calm: number } }>
  cues: Array<{ id: string; text: string; url: string; model: string }>
}
export interface AudioContextLike {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
}

const api = (path: string) => path
let manifest: SoundManifest | null = null
let manifestPromise: Promise<SoundManifest> | null = null

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(api(path), init)
  if (!response.ok) throw new Error(`sound ${response.status}`)
  return await response.json() as T
}

export async function warm(): Promise<void> {
  await fetch(api('/api/sound/warm'), { method: 'POST' }).catch(() => {})
}

export async function loadManifest(force = false): Promise<SoundManifest> {
  if (manifest && !force) return manifest
  if (manifestPromise && !force) return manifestPromise
  manifestPromise = request<SoundManifest>('/api/sound/manifest').then((value) => {
    manifest = value
    manifestPromise = null
    return value
  }).catch((error) => {
    manifestPromise = null
    throw error
  })
  return manifestPromise
}

function nearest(requested: SoundRequest, beds: SoundManifest['beds']): SoundInfo | null {
  const score = (bed: SoundManifest['beds'][number]) => {
    const input = bed.input
    if (!input) return 100
    return (input.kind === requested.kind ? 0 : 10) + (input.stage === requested.stage ? 0 : 4) + Math.abs(input.pace - requested.pace) + Math.abs(input.calm - requested.calm) * 3
  }
  return beds.slice().sort((a, b) => score(a) - score(b))[0] ?? null
}

export async function nextSegment(requested: SoundRequest, context?: AudioContextLike): Promise<{ buffer: AudioBuffer; info: SoundInfo }> {
  const ctx = context ?? requested.audioContext
  if (!ctx) throw new Error('nextSegment needs an AudioContext')
  const info = await request<SoundInfo>('/api/sound/segment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: requested.kind, stage: requested.stage, pace: requested.pace, calm: requested.calm, person: requested.person, waitMs: requested.waitMs }) })
  const response = await fetch(info.url)
  if (!response.ok) {
    const fallback = nearest(requested, (await loadManifest()).beds)
    if (!fallback) throw new Error(`sound clip ${response.status}`)
    const fallbackResponse = await fetch(fallback.url)
    if (!fallbackResponse.ok) throw new Error(`sound clip ${fallbackResponse.status}`)
    return { buffer: await ctx.decodeAudioData(await fallbackResponse.arrayBuffer()), info: fallback }
  }
  return { buffer: await ctx.decodeAudioData(await response.arrayBuffer()), info }
}

export async function cue(id: string): Promise<HTMLAudioElement | null> {
  const found = (await loadManifest()).cues.find((item) => item.id === id)
  if (!found || typeof Audio === 'undefined') return null
  const audio = new Audio(found.url)
  await audio.play().catch(() => {})
  return audio
}

export function resetForTests(): void {
  manifest = null
  manifestPromise = null
}
