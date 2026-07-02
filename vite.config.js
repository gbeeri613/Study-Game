import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Pure static SPA. Relative base so it works on Vercel and any static host.
export default defineConfig({
  plugins: [react()],
  base: './',
})
