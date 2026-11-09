/**
 * Loads parts of the app's TypeScript source into a Node.js tool: bundles a small entry module with
 * Vite (which resolves the app's imports, such as `/src/i18n/index.ts`) and imports the result.
 * Used by tools/check-i18n.mjs and tools/installer.mjs.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

/**
 * Bundles `entry`, the source of an ES module that imports from the app, and returns its exports.
 * @param {string} entry
 * @param {string} root the repository root, which `/src/…` imports start from
 * @returns {Promise<Record<string, any>>}
 */
export async function importApp(entry, root) {
  const tmp = mkdtempSync(join(tmpdir(), 'mockup-director-tool-'));
  try {
    const entryFile = join(tmp, 'entry.js');
    const outDir = join(tmp, 'out');
    writeFileSync(entryFile, entry);
    await build({
      root,
      configFile: false,
      logLevel: 'error',
      build: { ssr: entryFile, outDir, emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'entry.mjs' } } },
      ssr: { noExternal: true },
    });
    return await import(pathToFileURL(join(outDir, 'entry.mjs')).href);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
