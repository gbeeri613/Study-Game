import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Pure static SPA. Relative base so it works on Vercel and any static host.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
