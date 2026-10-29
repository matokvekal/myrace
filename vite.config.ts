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
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version || '0.1.2'),
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
