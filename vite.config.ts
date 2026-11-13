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
// The dependency scan starts from index.html alone, and the dev server does not watch src-tauri/:
// otherwise both crawl the Rust builds in src-tauri/target (many gigabytes, with copies of
// index.html) and dist-e2e/, and the app's window stays white for minutes at each start.
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  base: './',
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  optimizeDeps: { entries: ['index.html'] },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  plugins: mode === 'e2e' ? [e2eEntry] : [],
  build: {
    target: 'safari15',
    outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
