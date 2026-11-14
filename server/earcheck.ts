// "Watch a real check" (#/heard): one person's own check-in, camera off, read by the model their setup found
// (shared/earcheck.ts). The worker makes the bundle offline (scripts/realcheck.ts) and sends it here; it is kept
// next to the sessions (on a volume in production), never in the repo. Until one is sent, there is none.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isCheckBundle } from '../shared/earcheck'
import type { CheckBundle } from '../shared/earcheck'

const DIR = () => join(process.env.VIRE_EAR_DIR || '/bulk2/runs/depression/ear/recordings/', 'sessions')
/** not `.json`: the sessions folder's `.json` files are sessions */
const FILE = () => join(DIR(), 'check.pick')

export async function currentCheck(): Promise<CheckBundle | null> {
  try {
    const b: unknown = JSON.parse(await readFile(FILE(), 'utf8'))
    return isCheckBundle(b) ? b : null
  } catch {
    return null
  }
}

export async function keepCheck(x: unknown): Promise<CheckBundle | null> {
  if (!isCheckBundle(x)) return null
  await mkdir(DIR(), { recursive: true })
  await writeFile(FILE(), JSON.stringify(x))
  return x
}

export async function clearCheck(): Promise<void> {
  await rm(FILE(), { force: true })
}
