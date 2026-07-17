import { fileURLToPath } from 'node:url'
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
  resolve: {
    alias: {
      // canonical Room module — git submodule at the repo root (room-reunify 2026-07-17);
      // raw TS consumed straight from source, no packaging.
      'the-room': fileURLToPath(new URL('../the-room/src/index.ts', import.meta.url)),
    },
    // the submodule checkout has no node_modules — its react imports must land on
    // THIS app's react (one copy, hooks stay sane)
    dedupe: ['react', 'react-dom'],
  },
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
