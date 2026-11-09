/** Checks src-tauri/tauri.conf.json against the files it must agree with: package.json and LICENSE. */
import { describe, expect, it } from 'vitest';
import license from '../LICENSE?raw';
import tauri from '../src-tauri/tauri.conf.json';

describe('tauri.conf.json', () => {
  it('reads the version from package.json, the only version', () => {
    expect(tauri.version).toBe('../package.json');
  });

  it('has the copyright line of LICENSE', () => {
    const line = license.split(/\r?\n/).find((text) => text.startsWith('Copyright'));
    expect(tauri.bundle.copyright).toBe(line);
  });
});
