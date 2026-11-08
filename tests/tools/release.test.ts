import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import cargoToml from '../../src-tauri/Cargo.toml?raw';
import template from '../../tools/release-notes.md?raw';
import { cargoVersion, checkFiles, checkVersions, releaseFiles, renderNotes } from '../../tools/release.mjs';

describe('cargoVersion', () => {
  it('reads the version of the [package] section only', () => {
    const toml = [
      '[package]',
      'name = "mockup-director"',
      'version = "1.2.3"',
      '',
      '[dependencies]',
      'tauri = { version = "2.12" }',
      '',
      '[build-dependencies]',
      'version = "9.9.9"',
    ].join('\n');
    expect(cargoVersion(toml)).toBe('1.2.3');
  });

  it('is null without a version in [package]', () => {
    expect(cargoVersion('[package]\nname = "x"\n\n[dependencies]\nversion = "1.0.0"\n')).toBeNull();
  });

  it('reads the version of the real Cargo.toml', () => {
    expect(cargoVersion(cargoToml)).toBe(packageJson.version);
  });
});

describe('checkVersions', () => {
  it('accepts matching versions and a matching tag', () => {
    expect(checkVersions({ packageVersion: '0.2.0', cargoVersion: '0.2.0', tag: 'v0.2.0' })).toEqual({
      errors: [],
      version: '0.2.0',
      tag: 'v0.2.0',
      prerelease: false,
    });
  });

  it('treats a version with a hyphen as a pre-release', () => {
    const result = checkVersions({
      packageVersion: '0.3.0-beta.1',
      cargoVersion: '0.3.0-beta.1',
      tag: 'v0.3.0-beta.1',
    });
    expect(result).toMatchObject({ errors: [], prerelease: true });
  });

  it('works without a tag, for a release started by hand', () => {
    expect(checkVersions({ packageVersion: '0.2.0', cargoVersion: '0.2.0', tag: undefined })).toMatchObject({
      errors: [],
      tag: 'v0.2.0',
    });
  });

  it('refuses different versions in package.json and Cargo.toml', () => {
    const { errors } = checkVersions({ packageVersion: '0.2.0', cargoVersion: '0.1.0', tag: undefined });
    expect(errors).toEqual([
      'package.json has the version 0.2.0, but src-tauri/Cargo.toml has 0.1.0. Give both the same version.',
    ]);
  });

  it('refuses a tag that is not v<version>', () => {
    for (const tag of ['v0.2.1', '0.2.0', 'v0.2.0-beta.1']) {
      const { errors } = checkVersions({ packageVersion: '0.2.0', cargoVersion: '0.2.0', tag });
      expect(errors).toEqual([`The tag is ${tag}, but the version in package.json is 0.2.0: the tag must be v0.2.0.`]);
    }
  });

  it('refuses a version that is not semantic', () => {
    const { errors } = checkVersions({ packageVersion: '0.2', cargoVersion: '0.2', tag: undefined });
    expect(errors).toEqual(['The version 0.2 is not of the form 1.2.3 or 1.2.3-beta.1.']);
  });
});

describe('checkFiles', () => {
  it('accepts exactly the files of the release', () => {
    expect(checkFiles(releaseFiles('0.2.0'), '0.2.0')).toEqual([]);
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
