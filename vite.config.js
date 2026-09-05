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
          'react-vendor': ['react', 'react-dom'],
          'firebase-vendor': ['firebase/app', 'firebase/database', 'firebase/auth'],
        },
      },
    },
  },
  esbuild: { loader: 'jsx', include: /.*\.jsx?$/ },
  optimizeDeps: { include: ['firebase/app', 'firebase/database'] },
})
