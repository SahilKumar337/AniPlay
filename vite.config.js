import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  oxc: {
    drop: ['console', 'debugger'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'player-engine';
          if (id.includes('node_modules/gsap') || id.includes('node_modules/lenis')) return 'landing-animation';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'vendor-react';
          if (id.includes('node_modules/motion')) return 'motion';
          if (id.includes('/api/scrapers') || id.includes('/api/embedScraper') || id.includes('/api/stream') || id.includes('/utils/slugMatcher') || id.includes('/utils/megaplayDecrypt') || id.includes('/utils/vidplayDecrypt')) return 'scraper-engine';
        },
      },
    },
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'player-engine';
          if (id.includes('node_modules/gsap') || id.includes('node_modules/lenis')) return 'landing-animation';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'vendor-react';
          if (id.includes('node_modules/motion')) return 'motion';
          if (id.includes('/api/scrapers') || id.includes('/api/embedScraper') || id.includes('/api/stream') || id.includes('/utils/slugMatcher') || id.includes('/utils/megaplayDecrypt') || id.includes('/utils/vidplayDecrypt')) return 'scraper-engine';
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 3000,
    open: true,
    watch: {
      ignored: ['**/.playwright_profile*/**', '**/APKs/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
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
