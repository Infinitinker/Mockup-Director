/**
 * Tests tools/appimage-libraries.mjs: which files of the AppImage come from packages, reading the
 * output of dpkg -S and dpkg-query, finding each file's package by its name, and the list it writes.
 */
import { describe, expect, it } from 'vitest';
import {
  fenceFor,
  fromPackage,
  groupByPackage,
  launchpadUrl,
  parseQuery,
  parseSearch,
  renderList,
} from '../../tools/appimage-libraries.mjs';

describe('fromPackage', () => {
  it('leaves out the app, the AppImage tools, the copyright files and the generated caches', () => {
    for (const path of [
      'usr/bin/mockup-director',
      'usr/lib/Mockup Director/LICENSE.txt',
      'usr/share/icons/hicolor/32x32/apps/mockup-director.png',
      'AppRun',
      'AppRun.wrapped',
      'apprun-hooks/linuxdeploy-plugin-gtk.sh',
      'usr/share/doc/libgtk-3-0/copyright',
      'usr/lib/gio/modules/giomodule.cache',
      'usr/share/glib-2.0/schemas/gschemas.compiled',
    ])
      expect(fromPackage(path), path).toBe(false);
  });

  it('keeps the libraries, modules, helper programs and data of the packages', () => {
    for (const path of [
      'usr/lib/libgtk-3.so.0',
      'usr/lib/gio/modules/libgiognutls.so',
      'usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess',
      'usr/lib/girepository-1.0/Gtk-3.0.typelib',
      'usr/share/glib-2.0/schemas/org.gtk.Settings.FileChooser.gschema.xml',
    ])
      expect(fromPackage(path), path).toBe(true);
  });
});

describe('parseSearch', () => {
  it('reads the packages of each path, also several and with an architecture', () => {
    const output = [
      'libgtk-3-0:amd64: /usr/lib/x86_64-linux-gnu/libgtk-3.so.0',
      'libbz2-1.0:amd64: /lib/x86_64-linux-gnu/libbz2.so.1.0',
      'gir1.2-gtk-3.0:amd64, libgtk-3-dev:amd64: /usr/lib/x86_64-linux-gnu/girepository-1.0/Gtk-3.0.typelib',
      'diversion by dash from: /bin/sh',
      '',
    ].join('\n');
    expect(parseSearch(output)).toEqual(
      new Map([
        ['/usr/lib/x86_64-linux-gnu/libgtk-3.so.0', ['libgtk-3-0:amd64']],
        ['/lib/x86_64-linux-gnu/libbz2.so.1.0', ['libbz2-1.0:amd64']],
        ['/usr/lib/x86_64-linux-gnu/girepository-1.0/Gtk-3.0.typelib', ['gir1.2-gtk-3.0:amd64', 'libgtk-3-dev:amd64']],
      ]),
    );
  });
});

describe('groupByPackage', () => {
  const owners = new Map([
    ['/usr/lib/x86_64-linux-gnu/libgtk-3.so.0', ['libgtk-3-0:amd64']],
    ['/usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules/im-xim.so', ['libgtk-3-0:amd64']],
    ['/lib/x86_64-linux-gnu/libbz2.so.1.0', ['libbz2-1.0:amd64']],
    ['/usr/share/doc/a/README', ['a']],
    ['/usr/share/doc/b/README', ['b']],
  ]);

  it('finds each file by its name, in whatever folder the package has it', () => {
    const { byPackage, unowned } = groupByPackage(
      ['usr/lib/libgtk-3.so.0', 'usr/lib/gtk-3.0/3.0.0/immodules/im-xim.so', 'usr/lib/libbz2.so.1.0'],
      owners,
    );
    expect(byPackage).toEqual(
      new Map([
        ['libgtk-3-0:amd64', ['usr/lib/libgtk-3.so.0', 'usr/lib/gtk-3.0/3.0.0/immodules/im-xim.so']],
        ['libbz2-1.0:amd64', ['usr/lib/libbz2.so.1.0']],
      ]),
    );
    expect(unowned).toEqual([]);
  });

  it('counts a name several packages own for each of them', () => {
    expect(groupByPackage(['x/README'], owners).byPackage).toEqual(
      new Map([
        ['a', ['x/README']],
        ['b', ['x/README']],
      ]),
    );
  });

  it('names the files no package owns', () => {
    expect(groupByPackage(['usr/lib/libmine.so'], owners)).toEqual({
      byPackage: new Map(),
      unowned: ['usr/lib/libmine.so'],
    });
  });
});

describe('parseQuery', () => {
  it('reads the name, version and source of each package asked for', () => {
    const output = [
      'libgtk-3-0:amd64\tlibgtk-3-0\t3.24.33-1ubuntu2.2\tgtk+3.0\t3.24.33-1ubuntu2.2',
      'libbz2-1.0:amd64\tlibbz2-1.0\t1.0.8-5build1\tbzip2\t1.0.8-5build1',
      '',
    ].join('\n');
    expect(parseQuery(output)).toEqual(
      new Map([
        [
          'libgtk-3-0:amd64',
          { name: 'libgtk-3-0', version: '3.24.33-1ubuntu2.2', source: 'gtk+3.0', sourceVersion: '3.24.33-1ubuntu2.2' },
        ],
        [
          'libbz2-1.0:amd64',
          { name: 'libbz2-1.0', version: '1.0.8-5build1', source: 'bzip2', sourceVersion: '1.0.8-5build1' },
        ],
      ]),
    );
  });
});

describe('launchpadUrl', () => {
  it('links the source version, with its epoch', () => {
    expect(launchpadUrl('gtk+3.0', '3.24.33-1ubuntu2.2')).toBe(
      'https://launchpad.net/ubuntu/+source/gtk%2B3.0/3.24.33-1ubuntu2.2',
    );
    expect(launchpadUrl('zlib', '1:1.2.11.dfsg-2ubuntu9.2')).toBe(
      'https://launchpad.net/ubuntu/+source/zlib/1%3A1.2.11.dfsg-2ubuntu9.2',
    );
  });
});

describe('fenceFor', () => {
  it('is longer than any run of backticks in the text', () => {
    expect(fenceFor('no backticks')).toBe('```');
    expect(fenceFor('a ```` b')).toBe('`````');
  });
});

describe('renderList', () => {
  const gtk = {
    name: 'libgtk-3-0',
    version: '3.24.33-1ubuntu2.2',
    source: 'gtk+3.0',
    sourceVersion: '3.24.33-1ubuntu2.2',
    files: ['usr/lib/libgtk-3.so.0', 'usr/lib/gtk-3.0/3.0.0/immodules/im-xim.so'],
    copyright: 'Files: *\nLicense: LGPL-2+\n````\n',
  };
  const bz2 = {
    name: 'libbz2-1.0',
    version: '1.0.8-5build1',
    source: 'bzip2',
    sourceVersion: '1.0.8-5build1',
    files: ['usr/lib/libbz2.so.1.0'],
    copyright: 'BSD-style\n',
  };
  const list = renderList({
    version: '0.2.0',
    runtime: 'https://github.com/AppImage/type2-runtime/commit/fedfad5',
    packages: [gtk, bz2],
  });

  it('lists each package with its version, its source code and its files, by name', () => {
    expect(list).toContain('# The libraries in the Mockup Director 0.2.0 AppImage');
    expect(list).toContain(
      '| [libgtk-3-0](#libgtk-3-0) | 3.24.33-1ubuntu2.2 | [gtk+3.0 3.24.33-1ubuntu2.2](https://launchpad.net/ubuntu/+source/gtk%2B3.0/3.24.33-1ubuntu2.2) | 2 |',
    );
    expect(list.indexOf('| [libbz2-1.0](#libbz2-10)')).toBeLessThan(list.indexOf('| [libgtk-3-0]'));
    expect(list).toContain('`usr/lib/gtk-3.0/3.0.0/immodules/im-xim.so`, `usr/lib/libgtk-3.so.0`.');
  });

  it('names the AppImage runtime by its source', () => {
    expect(list).toContain('https://github.com/AppImage/type2-runtime/commit/fedfad5');
  });

  it('holds each copyright file whole, in a fence its text cannot end', () => {
    expect(list).toContain('`````\nFiles: *\nLicense: LGPL-2+\n````\n`````');
    expect(list).toContain('```\nBSD-style\n```');
  });
});
