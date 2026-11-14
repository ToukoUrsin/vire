// API + WebSocket URLs that work under any path prefix (the page lives at <base>/, the API at <base>/api).
export function apiUrl(path: string): string {
  return new URL(`api/${path.replace(/^\//, '')}`, document.baseURI).toString()
}

export function wsUrl(path: string): string {
  const u = new URL(`api/${path.replace(/^\//, '')}`, document.baseURI)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text().catch(() => '')}`)
  return (await res.json()) as T
}
