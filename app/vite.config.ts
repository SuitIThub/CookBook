import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// Single version source (also read by android/app/build.gradle).
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

// Astro dev server the app proxies to during browser development.
const ASTRO_DEV = process.env.ASTRO_DEV_URL ?? 'http://localhost:4321';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Reuse the Astro app's type declarations without pulling in its runtime.
      '@shared': fileURLToPath(new URL('../src/types', import.meta.url)),
      // The shared, driver-agnostic data layer (CookbookDatabase + SqlDriver).
      // Backed by sql.js in the app, better-sqlite3 on the server.
      '@core': fileURLToPath(new URL('../src/lib', import.meta.url))
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
  },
  preview: {
    proxy: {
      '/api': { target: ASTRO_DEV, changeOrigin: true },
      '/uploads': { target: ASTRO_DEV, changeOrigin: true }
    }
  }
});
