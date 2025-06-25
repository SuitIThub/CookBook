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
    server: {
      https: true,
    }
  },
  server: {
    port: 4321,
    host: true
  }
});
