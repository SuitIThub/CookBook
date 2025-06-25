// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind()],
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  vite: {
    plugins: [ basicSsl() ],
    build: {
      assetsInlineLimit: 0, // Ensure assets are properly cached
    },
    server: {
      headers: {
        // Enable service worker for development
        'Service-Worker-Allowed': '/'
      }
    }
  },
  // Ensure proper caching of assets
  build: {
    inlineStylesheets: 'never',
    assets: 'assets'
  }
});
