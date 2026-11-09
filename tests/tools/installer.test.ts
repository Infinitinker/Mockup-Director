import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/i18n';
import {
  findCompiler,
  INNO_LANGUAGES,
  innoMessage,
  languageSections,
  numericVersion,
  placeholders,
} from '../../tools/installer.mjs';

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

describe('innoMessage', () => {
  it('numbers the placeholders in the order of the English text and keeps line breaks', () => {
    const names = placeholders('{a} and {b}, {a}');
    expect(names).toEqual(['a', 'b']);
    expect(innoMessage('{b}\n\n{a}', names, 'pl: key')).toBe('%2%n%n%1');
  });

  it('rejects a placeholder the English text does not have', () => {
    expect(() => innoMessage('{c}', ['a'], 'pl: key')).toThrow('pl: key has the placeholder {c}');
  });

  it('rejects a percent sign', () => {
    expect(() => innoMessage('100%', [], 'en: key')).toThrow('en: key contains %');
  });
});

describe('languageSections', () => {
  const sections = languageSections(LOCALES);

  it('gives every interface language an Inno Setup messages file', () => {
    for (const { code } of LOCALES) expect(Object.keys(INNO_LANGUAGES)).toContain(code);
    expect(sections).toContain('Name: "en"; MessagesFile: "compiler:Default.isl"');
  });

  it('writes every installer message in every language', () => {
    expect(sections).toContain('en.DeleteData=Also delete');
    expect(sections).toContain('%n%n%1\r\n');
    for (const name of [
      'ProjectFile',
      'DeleteData',
      'DataNotDeleted',
      'WebView2Title',
      'WebView2Text',
      'WebView2ExitCode',
      'WebView2Failed',
    ])
      for (const { code } of LOCALES) expect(sections).toContain(`\r\n${code}.${name}=`);
  });

  it('asks for a messages file for a language Inno Setup does not know', () => {
    const extra = { code: 'xx', messages: LOCALES[0].messages };
    expect(() => languageSections([...LOCALES, extra])).toThrow('add it to INNO_LANGUAGES');
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
