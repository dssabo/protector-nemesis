import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On GitHub Pages this is served from https://dssabo.github.io/protector-nemesis/,
// so production assets need the '/protector-nemesis/' base. Local dev stays at '/'.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/protector-nemesis/' : '/',
  server: {
    host: true,
    port: 5173,
  },
}))
