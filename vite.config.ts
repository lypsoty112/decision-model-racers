/*
 * Vite configuration: React plugin and a fixed dev/preview port of 3991 on localhost.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 3991, strictPort: true },
  preview: { host: 'localhost', port: 3991, strictPort: true },
})
