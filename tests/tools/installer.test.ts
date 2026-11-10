/** Tests tools/installer.mjs: the four-part version Inno Setup takes, and where the Inno Setup compiler is found. */
import { describe, expect, it } from 'vitest';
import { findCompiler, numericVersion } from '../../tools/installer.mjs';

describe('numericVersion', () => {
  it('pads a release with a zero', () => {
    expect(numericVersion('1.2.3')).toBe('1.2.3.0');
  });

  it('drops the pre-release part', () => {
    expect(numericVersion('0.3.0-beta.1')).toBe('0.3.0.0');
  });

  it('rejects other versions', () => {
    expect(() => numericVersion('1.2')).toThrow('1.2 is not of the form');
  });
});

describe('findCompiler', () => {
  it('takes the ISCC variable first', () => {
    expect(findCompiler({ ISCC: 'D:\\Tools\\ISCC.exe' }, () => false)).toBe('D:\\Tools\\ISCC.exe');
  });

  it('looks in Program Files, then in the user programs', () => {
    const env = { ProgramW6432: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    expect(findCompiler(env, () => true)).toMatch(/^C:\\Program Files.Inno Setup 7.ISCC\.exe$/);
    expect(findCompiler(env, (path) => path.includes('Programs'))).toMatch(/Local.Programs.Inno Setup 7.ISCC\.exe$/);
    expect(findCompiler(env, () => false)).toBeNull();
  });
});
