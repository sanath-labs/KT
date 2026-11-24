import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        '**/*.db',
        '**/*.db-*',
        '**/*.sqlite',
        '**/*.sqlite-*',
        '**/*.log',
        '**/transit.db',
        '**/transit.db-journal',
        '**/transit.db-wal',
        '**/transit.db-shm',
      ],
    },
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
      '/socket.io': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
        ws: true,
      },
    },
  },
})
