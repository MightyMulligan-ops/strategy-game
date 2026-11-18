import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { europePreviewPlugin } from './dev/europe-preview.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), europePreviewPlugin()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3001' },
      '/api': { target: 'http://127.0.0.1:3001' },
    },
  },
})
