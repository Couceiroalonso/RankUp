import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'firebase-vendor': ['firebase/app', 'firebase/database', 'firebase/auth'],
        },
      },
    },
  },
  optimizeDeps: { include: ['firebase/app', 'firebase/database'] },
})
