/**
 * Checks src-tauri/tauri.conf.json against the files it must agree with (package.json and LICENSE),
 * and the identifier and data folder of each build: the release, the app run from source and the
 * end-to-end tests.
 */
import { describe, expect, it } from 'vitest';
import license from '../LICENSE?raw';
import tauri from '../src-tauri/tauri.conf.json';
import dev from '../src-tauri/tauri.dev.conf.json';
import e2e from '../src-tauri/tauri.e2e.conf.json';
import { E2E_DATA_FOLDER } from './e2e/folders';

describe('tauri.conf.json', () => {
  it('reads the version from package.json, the only version', () => {
    expect(tauri.version).toBe('../package.json');
  });

  it('has the copyright line of LICENSE', () => {
    const line = license.split(/\r?\n/).find((text) => text.startsWith('Copyright'));
    expect(tauri.bundle.copyright).toBe(line);
  });
});

describe('each build', () => {
  it('keeps its data in a folder named after the app', () => {
    expect(tauri.app.appDirectoriesOverride).toBe(`$LOCALDATA/${tauri.productName}`);
    expect(dev.app.appDirectoriesOverride).toBe(`$LOCALDATA/${tauri.productName} Dev`);
    expect(e2e.app.appDirectoriesOverride).toBe(`$LOCALDATA/${E2E_DATA_FOLDER}`);
    expect(E2E_DATA_FOLDER).toBe(`${tauri.productName} E2E`);
  });

  it('has its own identifier, which names its single-instance lock', () => {
    expect(dev.identifier).toBe(`${tauri.identifier}.dev`);
    expect(e2e.identifier).toBe(`${tauri.identifier}.e2e`);
  });
});
