import { describe, expect, it } from 'vitest';
import { APPIMAGE, KEPT, keptFile, normalize, npmEntries, renderNotices } from '../../tools/notices.mjs';

const mit = { file: 'LICENSE', text: 'MIT License\r\n\r\nCopyright (c) Someone  \r\n' };

function pkg(name: string, texts = [mit]) {
  return { name, version: '1.0.0', license: 'MIT', repository: `https://example.com/${name}`, texts };
}

describe('keptFile', () => {
  it('names the kept text after the package', () => {
    expect(keptFile('three')).toBe('three.txt');
    expect(keptFile('@tauri-apps/plugin-dialog')).toBe('tauri-apps-plugin-dialog.txt');
  });
});

describe('normalize', () => {
  it('gives the same text for CRLF and LF files', () => {
    expect(normalize('\r\nMIT  \r\n\r\nCopyright\t\r\n\r\n')).toBe('MIT\n\nCopyright');
    expect(normalize('MIT\n\nCopyright\n')).toBe('MIT\n\nCopyright');
  });
});

describe('npmEntries', () => {
  it('uses the license files a package contains', () => {
    const { entries, used, errors } = npmEntries([pkg('three')], new Map());
    expect(errors).toEqual([]);
    expect(used.size).toBe(0);
    expect(entries[0].texts).toEqual([mit]);
  });

  it('uses the kept text of a package without a license file', () => {
    const kept = new Map([['tauri-apps-plugin-dialog.txt', 'MIT License']]);
    const { entries, used, errors } = npmEntries([pkg('@tauri-apps/plugin-dialog', [])], kept);
    expect(errors).toEqual([]);
    expect([...used]).toEqual(['tauri-apps-plugin-dialog.txt']);
    expect(entries[0].texts).toEqual([{ file: 'tauri-apps-plugin-dialog.txt', text: 'MIT License' }]);
  });

  it('stops on a package without any license text, and says where to put one', () => {
    const { errors } = npmEntries([pkg('left-pad', [])], new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('left-pad 1.0.0');
    expect(errors[0]).toContain('https://example.com/left-pad');
    expect(errors[0]).toContain(`${KEPT}/left-pad.txt`);
  });
});

describe('renderNotices', () => {
  const bundled = [{ title: 'Runtime', about: 'Linked into the app.', source: 'https://example.com/rt', text: 'RT' }];

  it('lists the bundled parts, the npm packages with their sources, then the Rust crates', () => {
    const text = renderNotices({ bundled, npm: [pkg('three')], rust: '## Rust crates\r\n\r\n### MIT\r\n' });
    const order = [
      '## Windows app',
      '### Runtime',
      '## JavaScript packages',
      '### three 1.0.0 (MIT)',
      '## Rust crates',
      '## Linux AppImage',
    ];
    const at = order.map((heading) => text.indexOf(heading));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain('Source: https://example.com/three');
    expect(text).toContain('```\nMIT License\n\nCopyright (c) Someone\n```');
    expect(text).not.toContain('\r');
    expect(text).toContain('### MIT\n\n## Linux AppImage');
    expect(text.endsWith(`${APPIMAGE}\n`)).toBe(true);
  });

  it('names the files of a package with more than one license', () => {
    const two = pkg('dual', [
      { file: 'LICENSE-APACHE', text: 'Apache' },
      { file: 'LICENSE-MIT', text: 'MIT' },
    ]);
    const text = renderNotices({ bundled, npm: [two], rust: '' });
    expect(text).toContain('LICENSE-APACHE:\n\n```\nApache\n```');
    expect(text).toContain('LICENSE-MIT:\n\n```\nMIT\n```');
  });

  it('keeps a license text with backticks inside its code block', () => {
    const text = renderNotices({ bundled, npm: [pkg('ticks', [{ file: 'LICENSE', text: 'see ```x```' }])], rust: '' });
    expect(text).toContain('````\nsee ```x```\n````');
  });
});
