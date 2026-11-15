import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// Backend location for the dev proxy; override when port 3000 is taken:
//   BACKEND_URL=http://localhost:3100 npm run dev
const backend = process.env.BACKEND_URL || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
  build: {
    rollupOptions: {
      output: {
        // Keep rarely-changing libraries in their own cacheable chunks.
        manualChunks: {
          react: ['react', 'react-dom'],
          map: ['leaflet', 'react-leaflet'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: backend,
        ws: true,
      },
    },
  },
})
