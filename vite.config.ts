import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Excalidraw checks this at runtime.
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
})
