import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend binds 127.0.0.1 only (no auth), so the proxy targets that address
// rather than `localhost`, which may resolve to ::1 first and miss it.
const BACKEND = 'http://127.0.0.1:47821'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 47823,
    // Another process on the port would otherwise move Vite to the next one
    // silently, and `make down` (which reads this port) would miss it.
    strictPort: true,
    // The backend mounts its API at /api/v1, the mock router at /mock and the
    // probe at /health, so every path is passed through unchanged.
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/mock': { target: BACKEND, changeOrigin: true },
      '/health': { target: BACKEND, changeOrigin: true },
    },
  },
})
