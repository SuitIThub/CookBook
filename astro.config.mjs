// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  integrations: [tailwind()],
  security: {
    // Needed for Android Web Share Target POST handoff from external apps.
    // Astro's default origin check rejects these as cross-site form posts.
    checkOrigin: false
  },
  output: 'server',
  adapter: node({
    mode: 'standalone'
  })
});
