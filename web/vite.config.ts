import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// base './' + HashRouter: the build runs under any path prefix (funnel mount /vire, Fly root, iOS shell).
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5871,
    proxy: { '/api': { target: 'http://127.0.0.1:8871', ws: true } },
    fs: { allow: ['..'] },
  },
})
