import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../simple-shared/src'),
    },
  },
  server: {
    port: 3004,
    strictPort: true, // fail fast instead of silently stealing another app's port
    // Proxy /api and /ws requests to the Express server during development
    proxy: {
      '/api': 'http://localhost:3003',
      '/ws': {
        target: 'ws://localhost:3003',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
