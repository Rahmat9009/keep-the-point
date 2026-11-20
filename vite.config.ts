import { defineConfig } from 'vite';

export default defineConfig({
  // Inline (empty) PostCSS config so Vite doesn't pick up a config from a parent folder.
  css: { postcss: {} },
});
