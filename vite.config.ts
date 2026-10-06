/*
 * Vite configuration: React, the decision-model API middleware (fed OPENROUTER_API_KEY from .env
 * or the environment, on the server only), a fixed dev port of 3991 on localhost, and a preview
 * server that also answers Railway's *.up.railway.app domains in production.
 */
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { decisionApi } from './server/decisionApi.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), decisionApi(loadEnv(mode, process.cwd(), '').OPENROUTER_API_KEY ?? '')],
  server: { host: 'localhost', port: 3991, strictPort: true },
  preview: { host: 'localhost', port: 3991, strictPort: true, allowedHosts: ['.up.railway.app'] },
}))
