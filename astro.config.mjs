// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // React only for shared islands (src/dashboard, also used by the app).
  integrations: [tailwind(), react()],
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
