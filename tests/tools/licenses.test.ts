/**
 * Tests the license check in tools/licenses.mjs: which license expressions are allowed, and the npm packages it
 * reads from package-lock.json, by name and whether the app ships them.
 */
import { describe, expect, it } from 'vitest';
import { isAllowed, npmPackages } from '../../tools/licenses.mjs';

describe('isAllowed', () => {
  it('accepts permissive licenses and the MPL-2.0', () => {
    expect(isAllowed('MIT')).toBe(true);
    expect(isAllowed('MPL-2.0')).toBe(true);
  });

  it('accepts a choice when one of the licenses is allowed, and a combination only when all are', () => {
    expect(isAllowed('(MIT OR GPL-3.0)')).toBe(true);
    expect(isAllowed('MIT AND Zlib')).toBe(true);
    expect(isAllowed('MIT AND GPL-3.0')).toBe(false);
  });

  it('rejects copyleft licenses and a missing license', () => {
    expect(isAllowed('GPL-3.0-only')).toBe(false);
    expect(isAllowed('LGPL-2.1')).toBe(false);
    expect(isAllowed(null)).toBe(false);
    expect(isAllowed('')).toBe(false);
  });
});

describe('npmPackages', () => {
  it('lists the packages by name, the same on every system, and marks the shipped ones', () => {
    const lock = {
      packages: {
        '': { name: 'mockup-director' },
        'node_modules/zod': { version: '1.0.0', license: 'MIT' },
        'node_modules/@scope/b': { version: '2.0.0', license: 'ISC', dev: true },
        'node_modules/Apple': { version: '3.0.0', license: 'MIT' },
      },
    };
    const names = npmPackages(lock).map((p) => [p.name, p.shipped]);
    expect(names).toEqual([
      ['@scope/b', false],
      ['Apple', true],
      ['zod', true],
    ]);
  });
});
