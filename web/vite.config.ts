import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// PRODUCTION: the standalone watcher serves this built dist/ statically AND the
// /api endpoints on the same origin, so no proxy is involved once shipped.
//
// DEV ONLY: `vite dev` proxies /api/* (roster poll + SSE stream) to whatever is
// serving the endpoints. Point it at the real watcher, or at the fixture mock
// in ./mock (see mock/server.mjs) via CR_API. Default is the fixture mock port.
const API_TARGET = process.env.CR_API || 'http://localhost:8181'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // SSE: keep the connection open, don't buffer the event stream
        ws: false,
      },
    },
  },
})
