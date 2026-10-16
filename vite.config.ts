import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    // Поддержка телефонов постарше (Safari 14+ — iPhone 6s/7 на iOS 15): esbuild понижает синтаксис
    target: ['es2020', 'safari14', 'chrome87', 'edge88', 'firefox78'],
  },
})
