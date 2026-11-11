/**
 * Tests the release rules in tools/release.mjs: the version and its tag, the files of each build and of the
 * whole release, and the release notes made from tools/release-notes.md.
 */
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import template from '../../tools/release-notes.md?raw';
import { checkFiles, checkVersion, PARTS, releaseFiles, renderNotes } from '../../tools/release.mjs';

describe('checkVersion', () => {
  it('accepts a version and a matching tag', () => {
    expect(checkVersion({ version: '0.2.0', tag: 'v0.2.0' })).toEqual({
      errors: [],
      version: '0.2.0',
      tag: 'v0.2.0',
      prerelease: false,
    });
  });

  it('treats a version with a hyphen as a pre-release', () => {
    const result = checkVersion({ version: '0.3.0-beta.1', tag: 'v0.3.0-beta.1' });
    expect(result).toMatchObject({ errors: [], prerelease: true });
  });

  it('works without a tag, for a release started by hand', () => {
    expect(checkVersion({ version: '0.2.0', tag: undefined })).toMatchObject({ errors: [], tag: 'v0.2.0' });
  });

  it('accepts the version in package.json', () => {
    expect(checkVersion({ version: packageJson.version, tag: undefined }).errors).toEqual([]);
  });

  it('refuses a missing version', () => {
    expect(checkVersion({ version: undefined, tag: 'v0.2.0' })).toEqual({ errors: ['package.json has no version.'] });
  });

  it('refuses a tag that is not v<version>', () => {
    for (const tag of ['v0.2.1', '0.2.0', 'v0.2.0-beta.1']) {
      const { errors } = checkVersion({ version: '0.2.0', tag });
      expect(errors).toEqual([`The tag is ${tag}, but the version in package.json is 0.2.0: the tag must be v0.2.0.`]);
    }
  });

  it('refuses a version that is not semantic', () => {
    const { errors } = checkVersion({ version: '0.2', tag: undefined });
    expect(errors).toEqual(['The version 0.2 is not of the form 1.2.3 or 1.2.3-beta.1.']);
  });
});

describe('checkFiles', () => {
  it('accepts exactly the files of the release', () => {
    expect(checkFiles(releaseFiles('0.2.0'), '0.2.0')).toEqual([]);
  });

  it('checks the files of one build on their own', () => {
    expect(releaseFiles('0.2.0', 'macos')).toEqual(['MockupDirector-0.2.0-macos-universal.dmg']);
    expect(checkFiles(releaseFiles('0.2.0', 'windows'), '0.2.0', 'windows')).toEqual([]);
    expect(checkFiles(releaseFiles('0.2.0', 'windows'), '0.2.0', 'linux')).toContain(
      'MockupDirector-0.2.0-windows-x64-setup.exe is not a file of the linux build.',
    );
  });

  it('makes up the whole release from its parts', () => {
    const parts = Object.keys(PARTS).flatMap((part) => releaseFiles('0.2.0', part));
    expect(parts).toEqual(releaseFiles('0.2.0'));
    expect(() => releaseFiles('0.2.0', 'android')).toThrow(/android is not a part/);
  });

  it('names missing and unexpected files', () => {
    const names = releaseFiles('0.2.0').filter((f) => !f.endsWith('.dmg'));
    names.push('MockupDirector-0.1.0-macos-universal.dmg');
    expect(checkFiles(names, '0.2.0')).toEqual([
      'MockupDirector-0.2.0-macos-universal.dmg is missing.',
      'MockupDirector-0.1.0-macos-universal.dmg is not a file of the release.',
    ]);
  });
});

describe('renderNotes', () => {
  const values = {
    version: '0.2.0',
    tag: 'v0.2.0',
    repository: 'Infinitinker/Mockup-Director',
    checksums: releaseFiles('0.2.0').map((name, i) => ({ name, sha256: String(i).repeat(64) })),
  };

  it('links every file of the release and lists its checksum', () => {
    const notes = renderNotes(template, values);
    for (const name of releaseFiles('0.2.0')) {
      expect(notes).toContain(`(https://github.com/Infinitinker/Mockup-Director/releases/download/v0.2.0/${name})`);
    }
    for (const { name, sha256 } of values.checksums) expect(notes).toContain(`${sha256}  ${name}`);
    expect(notes).not.toMatch(/\{\w+\}/);
  });

  it('refuses a placeholder it has no value for', () => {
    expect(() => renderNotes('Mockup Director {versoin}', values)).toThrow(/\{versoin\}/);
    expect(() => renderNotes('{constructor}', values)).toThrow(/\{constructor\}/);
  });
});
