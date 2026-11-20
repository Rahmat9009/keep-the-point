import { defineConfig } from 'vite';

export default defineConfig({
  // Served from https://<user>.github.io/keep-the-point/ on GitHub Pages.
  base: '/keep-the-point/',
  // Inline (empty) PostCSS config so Vite doesn't pick up a config from a parent folder.
  css: { postcss: {} },
});
