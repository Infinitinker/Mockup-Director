/** Reading the session records and building the index a save writes, without IndexedDB. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../src/core/errors';
import { toProjectFile } from '../../src/ui/project';
import {
  buildIndex,
  damagedSession,
  isNewerIndex,
  readIndex,
  readSession,
  readTabRecord,
  SESSION_DAMAGED,
  SESSION_NEWER,
  SESSION_VERSION,
} from '../../src/ui/sessionRecords';
import { documentState } from '../fixtures';

const file = toProjectFile(documentState('box'));
const record = { savedAt: 1, file };
const newerRecord = { savedAt: 1, file: { ...file, version: file.version + 1 } };
const entry = (id: string, name = '', dirty = false) => ({ id, name, dirty });

function errorOf(fn: () => unknown): UserError {
  try {
    fn();
  } catch (e) {
    if (e instanceof UserError) return e;
    throw e;
  }
  throw new Error('nothing was thrown');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('readIndex', () => {
  it('reads a valid index unchanged', () => {
    const raw = { version: SESSION_VERSION, activeId: 'b', tabs: [entry('a', 'Box', true), entry('b')] };
    expect(readIndex(raw)).toEqual({ index: raw, malformed: 0 });
  });

  it('refuses an index from a newer version and says to update', () => {
    const raw = { version: SESSION_VERSION + 1, activeId: '', tabs: [] };
    expect(isNewerIndex(raw)).toBe(true);
    expect(errorOf(() => readIndex(raw)).message).toBe(SESSION_NEWER);
  });

  it('says to update for an index from a newer version whose shape changed', () => {
    expect(errorOf(() => readIndex({ version: SESSION_VERSION + 1, tabs: {} })).message).toBe(SESSION_NEWER);
  });

  it('tells a damaged index apart from a newer one', () => {
    for (const raw of [null, 'session', [], {}, { version: '1', tabs: [] }, { version: 1, tabs: {} }]) {
      expect(isNewerIndex(raw)).toBe(false);
      expect(readIndex(raw)).toBe('damaged');
    }
  });

  it('counts malformed entries and fills in missing names and flags', () => {
    const raw = {
      version: SESSION_VERSION,
      activeId: 7,
      tabs: [
        null,
        'a',
        { id: '' },
        { id: 3 },
        { id: 'a', name: 5 },
        { id: 'a', name: 'Again' },
        { id: 'b', dirty: false },
      ],
    };
    expect(readIndex(raw)).toEqual({
      index: { version: SESSION_VERSION, activeId: '', tabs: [entry('a', '', true), entry('b', '', false)] },
      malformed: 5,
    });
  });
});

describe('readTabRecord', () => {
  it('reads the project of a record', () => {
    expect(readTabRecord(record)).toEqual({ project: { file, report: { settings: 0, artwork: 0 } } });
  });

  it('marks a project that a newer version may open', () => {
    expect(readTabRecord(newerRecord)).toEqual({ skipped: 'newer' });
    expect(readTabRecord({ file: { ...file, modelId: 'model-of-a-newer-version' } })).toEqual({ skipped: 'newer' });
  });

  it('marks a damaged record', () => {
    for (const raw of [
      null,
      'tab',
      [],
      {},
      { file: null },
      { file: { ...file, app: 'other' } },
      { file: { ...file, version: 0 } },
      { file: { ...file, modelId: 7 } },
    ]) {
      expect(readTabRecord(raw)).toEqual({ skipped: 'damaged' });
    }
  });
});

describe('readSession', () => {
  const index = (activeId: string, ...ids: string[]) => ({
    index: { version: SESSION_VERSION, activeId, tabs: ids.map((id) => entry(id, id.toUpperCase())) },
    malformed: 0,
  });

  it('restores every tab in index order with the stored active tab', () => {
    const loaded = readSession(
      index('b', 'a', 'b'),
      new Map([
        ['a', record],
        ['b', record],
      ]),
    );
    expect(loaded.session.activeId).toBe('b');
    expect(loaded.session.tabs.map((t) => [t.id, t.name, t.file])).toEqual([
      ['a', 'A', file],
      ['b', 'B', file],
    ]);
    expect(loaded.kept).toEqual([]);
    expect(loaded.dropped).toEqual([]);
    expect(loaded.skipped).toBe(0);
    expect(loaded.indexDamaged).toBe(false);
  });

  it('keeps the entry of a newer record, drops damaged and missing ones and counts the dropped', () => {
    const loaded = readSession(
      { ...index('b', 'a', 'b', 'c', 'd', 'e'), malformed: 2 },
      new Map<string, unknown>([
        ['a', record],
        ['b', { file: 'damaged' }],
        ['c', undefined],
        ['e', newerRecord],
      ]),
    );
    expect(loaded.session.tabs.map((t) => t.id)).toEqual(['a']);
    expect(loaded.kept).toEqual([entry('e', 'E')]);
    expect(loaded.dropped).toEqual(['b']);
    expect(loaded.skipped).toBe(5);
  });

  it('shows the first tab when the active one is not restored, and none when no tab is', () => {
    expect(readSession(index('b', 'a', 'b'), new Map([['a', record]])).session.activeId).toBe('a');
    const empty = readSession(index('a', 'a'), new Map([['a', newerRecord]]));
    expect(empty.session).toEqual({ activeId: '', tabs: [] });
    expect(empty.kept).toEqual([entry('a', 'A')]);
  });
});

describe('damagedSession', () => {
  it('restores nothing and drops every tab record, so the next save deletes them and writes a new index', () => {
    const loaded = damagedSession(['session', 'tab:a', 'tab:b', 7, 'other']);
    expect(loaded).toEqual({
      session: { activeId: '', tabs: [] },
      kept: [],
      dropped: ['a', 'b'],
      skipped: 0,
      indexDamaged: true,
    });
  });

  it('says that unsaved changes are lost and the projects must be opened again', () => {
    expect(SESSION_DAMAGED).toMatch(/damaged.*are lost\. Open your projects again from their files\.$/);
  });
});

describe('buildIndex', () => {
  it('lists the open tabs in tab order, then the kept entries that are not open', () => {
    const open = [{ ...entry('a', 'Box', true), revision: 3 }, entry('b')];
    expect(buildIndex(open, 'a', [entry('k'), entry('b', 'Old')])).toEqual({
      version: SESSION_VERSION,
      activeId: 'a',
      tabs: [entry('a', 'Box', true), entry('b'), entry('k')],
    });
  });

  it('writes an index that reads back unchanged', () => {
    const written = buildIndex([entry('a', 'Box')], 'a', [entry('k', 'Kept', true)]);
    expect(readIndex(JSON.parse(JSON.stringify(written)))).toEqual({ index: written, malformed: 0 });
  });
});
