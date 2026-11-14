export function displayName(name: string | null | undefined, max = 24): string {
  const clean = (name ?? '').trim()
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 1))}…` : clean
}
