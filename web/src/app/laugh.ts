const DB_NAME = 'vire-phone-only'
const STORE = 'audio'
const KEY = 'loved-laugh'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveLovedLaugh(blob: Blob): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  try { localStorage.setItem('vire.lovedLaugh', '1') } catch { /* private mode */ }
  db.close()
}

export async function loadLovedLaugh(): Promise<string | null> {
  try {
    const db = await open()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}
