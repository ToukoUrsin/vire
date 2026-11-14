import { useMemo } from 'react'
import { encode } from 'uqr'

/** A QR code as one crisp SVG path. Colours are fixed (dark on light) so every phone camera reads it, on screen and on paper. */
export function Qr({ text, className, dark = '#14110d', light = '#fffdf8' }: { text: string; className?: string; dark?: string; light?: string }) {
  const { d, n } = useMemo(() => {
    const q = encode(text, { ecc: 'M', border: 3 })
    let path = ''
    q.data.forEach((row, y) => row.forEach((on, x) => on && (path += `M${x} ${y}h1v1h-1z`)))
    return { d: path, n: q.size }
  }, [text])
  return (
    <svg className={className} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={`QR code: ${text}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill={light} />
      <path d={d} fill={dark} />
    </svg>
  )
}
