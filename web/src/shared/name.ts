export function displayName(name: string | null | undefined, max = 24): string {
  const clean = (name ?? '').trim()
  // the cut never ends on a space, so the ellipsis stays on the last word and cannot wrap alone
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…` : clean
}
