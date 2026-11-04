import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // The Pages artifact is public — never ship source maps (they embed the
    // full original TypeScript). `npm run build` additionally runs
    // scripts/verify-dist.mjs to strip anything else that leaked via public/.
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/app'),
    },
  },
  // No `define` for VITE_APP_VERSION: src/app/version.json is the version shown
  // in the app. (A define from package.json's "0.1.2" used to override it.) A real
  // VITE_APP_VERSION env var at build time still wins, through Vite's own env.
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
