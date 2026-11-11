/**
 * Tests the license check in tools/licenses.mjs: which license expressions are allowed, the npm packages it
 * reads from package-lock.json, by name and whether the app ships them, and the build-only exceptions.
 */
import { describe, expect, it } from 'vitest';
import { type NpmPackage, checkLicenses, isAllowed, npmPackages } from '../../tools/licenses.mjs';

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

describe('checkLicenses', () => {
  const pkg = (name: string, version: string, license: string | null, shipped: boolean): NpmPackage => ({
    path: `node_modules/${name}`,
    name,
    version,
    license,
    repository: null,
    shipped,
  });
  const exceptions = new Map([['css-value@0.0.1', 'names no license; build-only']]);
  const names = (packages: NpmPackage[]) => packages.map((p) => `${p.name}@${p.version}`);

  it('accepts a build-only package that an exception names by name and version', () => {
    const result = checkLicenses(
      [pkg('css-value', '0.0.1', null, false), pkg('three', '1.0.0', 'MIT', true)],
      exceptions,
    );
    expect(names(result.excepted)).toEqual(['css-value@0.0.1']);
    expect(result.bad).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('checks another version of an excepted package as usual', () => {
    const result = checkLicenses([pkg('css-value', '0.0.2', null, false)], exceptions);
    expect(names(result.bad)).toEqual(['css-value@0.0.2']);
    expect(result.excepted).toEqual([]);
  });

  it('never excepts a shipped package', () => {
    const result = checkLicenses([pkg('css-value', '0.0.1', null, true)], exceptions);
    expect(names(result.bad)).toEqual(['css-value@0.0.1']);
    expect(result.excepted).toEqual([]);
  });

  it('fails on an exception that matches no installed package', () => {
    const result = checkLicenses([pkg('three', '1.0.0', 'MIT', true)], exceptions);
    expect(result.stale).toEqual(['css-value@0.0.1']);
    expect(result.bad).toEqual([]);
  });
});
