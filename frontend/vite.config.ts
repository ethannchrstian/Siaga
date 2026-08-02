import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Vite's dep optimizer fails to emit maplibre's worker file
    // ("maplibre-gl-worker.mjs" pending forever); serve it unbundled.
    exclude: ['maplibre-gl'],
  },
})
