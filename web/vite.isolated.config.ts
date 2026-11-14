// The same dev server with /api sent to a test instance instead of the live server, so screenshot and e2e runs
// (judging/shots.mjs) leave no test people in the real clinic list. See the header of judging/shots.mjs.
//   cd server && PORT=8873 VIRE_DB=/tmp/vire-test.sqlite VIRE_RATE=off bun run index.ts
//   cd web && VIRE_API=http://127.0.0.1:8873 bunx vite --config vite.isolated.config.ts --port 5881 --strictPort
import base from './vite.config.ts'

export default {
  ...base,
  server: {
    ...base.server,
    proxy: { '/api': { target: process.env.VIRE_API ?? 'http://127.0.0.1:8873', ws: true } },
  },
}
