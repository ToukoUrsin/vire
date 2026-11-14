import { Qr } from './Qr'
import { HONEST, TABLE, bare, visitUrl } from './lib'

/** `#/wall/poster`: one A4 portrait sheet (vector, so it prints as A3 too). Paper tokens, one QR, nothing live. */
export function Poster() {
  return (
    <div className="wl-poster-page">
      <button className="wl-print" onClick={() => window.print()}>
        Print (A4 or A3, no margins)
      </button>
      <article className="wl-sheet">
        <header className="wl-sheet-top">
          <b>Vire</b>
          <span>Junction 2026, {TABLE}</span>
        </header>

        <h1>60 seconds on your own face</h1>

        <div className="wl-sheet-mid">
          <div className="wl-sheet-qr">
            <Qr text={visitUrl()} light="#ffffff" />
            <p>{bare(visitUrl())}</p>
          </div>
          <p className="wl-sheet-lede">Only four numbers leave your phone. No picture, no sound.</p>
        </div>

        <footer className="wl-sheet-foot">
          <div>
            <p className="wl-sheet-table">{TABLE}</p>
            <p className="wl-sheet-back">Scan, then find your dot on the wall.</p>
          </div>
          <p className="wl-sheet-fine">{HONEST}</p>
        </footer>
      </article>
    </div>
  )
}
