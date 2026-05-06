import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const phoneBackend = process.env.PI_PHONE_BACKEND;
const phoneBackendWs = phoneBackend?.replace(/^http/i, 'ws');

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: phoneBackend
    ? {
        proxy: {
          '/api': {
            target: phoneBackend,
            changeOrigin: true,
          },
          '/ws': {
            target: phoneBackendWs,
            ws: true,
            changeOrigin: true,
          },
        },
      }
    : undefined,
});
