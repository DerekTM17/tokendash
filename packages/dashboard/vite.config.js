import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves a project repo under /<repo>/, so the production build
// needs that base; the dev server stays at root. useTokenData fetches
// tokens.json via import.meta.env.BASE_URL, so it follows whichever base is set.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'build' ? '/token-dashboard/' : '/',
  test: {
    environment: 'jsdom',
    setupFiles: [],
  },
}));
