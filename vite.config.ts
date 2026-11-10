import { defineConfig, type Plugin } from 'vite';

/**
 * The end-to-end test build (vite build --mode e2e, see tests/e2e): index.html loads the test entry
 * tests/e2e/app/entry.ts, which installs the WebdriverIO bridge before it starts the app. Runs before
 * Vite collects the module scripts of index.html.
 */
const e2eEntry: Plugin = {
  name: 'e2e-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => {
      const swapped = html.replace('/src/main.ts', '/tests/e2e/app/entry.ts');
      if (swapped === html) throw new Error('index.html no longer loads /src/main.ts: update the e2e entry swap.');
      return swapped;
    },
  },
};

// Tauri expects a fixed port and does not want the screen cleared. The e2e mode writes to its own
// folder, so the test build never replaces dist/, which the shell and release builds embed.
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  base: './',
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  plugins: mode === 'e2e' ? [e2eEntry] : [],
  build: {
    target: 'safari15',
    outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
