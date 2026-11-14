import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shared/theme.css'
import App from './App.tsx'

// the page's own "didn't load" notice (index.html) stands down once the app is up
;(window as unknown as { __vireUp?: boolean }).__vireUp = true
try {
  sessionStorage.removeItem('vire.boot')
} catch {
  /* private mode */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// After one visit the app opens without a connection (public/sw.js). Not in development, where it would hide edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {})
  })
}
