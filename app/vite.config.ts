import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Astro dev server the app proxies to during browser development.
const ASTRO_DEV = process.env.ASTRO_DEV_URL ?? 'http://localhost:4321';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Reuse the Astro app's type declarations without pulling in its runtime.
      '@shared': fileURLToPath(new URL('../src/types', import.meta.url))
    }
  },
  server: {
    port: 5173,
    // Browser dev: forward API + uploaded assets to the Astro server so the
    // app can use relative paths and avoid CORS. On device this is replaced
    // by VITE_API_BASE_URL pointing at the real server.
    proxy: {
      '/api': { target: ASTRO_DEV, changeOrigin: true },
      '/uploads': { target: ASTRO_DEV, changeOrigin: true }
    }
  }
});
