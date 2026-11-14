// Where the personal model lives: localStorage 'vire.model', one small JSON document (well under 50 KB).
import type { PersonalModel } from './model'

const KEY = 'vire.model'

export function loadModel(): PersonalModel | null {
  try {
    const raw = localStorage.getItem(KEY)
    const m = raw ? (JSON.parse(raw) as PersonalModel) : null
    return m && m.version === 1 && m.calibration && Array.isArray(m.calibration.smile) && Array.isArray(m.calibration.brow) ? m : null
  } catch {
    return null
  }
}

export function saveModel(m: PersonalModel): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* private mode: the model lives for this session only */
  }
}

export function clearModel(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
