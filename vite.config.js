import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    watch: {
      ignored: ['**/.playwright_profile/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Proxy to avoid CORS on Consumet API
      '/consumet': {
        target: 'https://api.consumet.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/consumet/, ''),
        secure: false,
      },
    },
  },
})
