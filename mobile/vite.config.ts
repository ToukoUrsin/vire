import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// The app is served at <site>/app/ next to the main Vire site. The sensing and ear-model code is imported from
// ../web/src as it is; that code finds the API, the face model and the audio relative to the page, which here
// would be /app/. They live at the site root, so in those files the page's base is read as the site root.
function siteRoot(): Plugin {
  return {
    name: 'vire-site-root',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/web/src/') || !code.includes('document.baseURI')) return null
      return { code: code.replaceAll('document.baseURI', "(location.origin + '/')"), map: null }
    },
  }
}

const SITE = process.env.VIRE_SITE ?? 'https://vire.fly.dev'
const proxy = Object.fromEntries(['/api', '/wasm', '/models', '/audio'].map((p) => [p, { target: SITE, changeOrigin: true, ws: true }]))

export default defineConfig({
  base: '/app/',
  plugins: [siteRoot(), react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
      '@web': fileURLToPath(new URL('../web/src', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 900 },
  server: { port: 5881, host: '127.0.0.1', proxy, fs: { allow: ['..'] } },
})
