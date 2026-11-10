/**
 * Reading the session records, building the index a save writes and the file a kept copy is saved
 * to, without IndexedDB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../src/core/errors';
import { MAX_PROJECT_SIZE, toProjectFile } from '../../src/project/format';
import {
  buildIndex,
  COPY_UNWRITABLE,
  copyTooLarge,
  isNewerIndex,
  type LoadedSession,
  readIndex,
  readSession,
  readTabRecord,
  SESSION_DAMAGED,
  SESSION_NEWER,
  SESSION_VERSION,
  tabIdOf,
  unopenedFileName,
  unopenedFileText,
} from '../../src/documents/sessionRecords';
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

describe('tabIdOf', () => {
  it('reads the tab id of a record key and nothing else', () => {
    expect(tabIdOf('tab:a1')).toBe('a1');
    for (const key of ['session', 'tab:', 'other:a', 7, ['tab:a']]) expect(tabIdOf(key)).toBeNull();
  });
});

describe('readSession', () => {
  const index = (activeId: string, ...ids: string[]) => ({
    version: SESSION_VERSION,
    activeId,
    tabs: ids.map((id) => entry(id, id.toUpperCase())),
  });
  const storedAt = (savedAt: number) => ({ savedAt, file });
  /** Reads a session that must not be null. */
  function read(rawIndex: unknown, records: [string, unknown][]): LoadedSession {
    const loaded = readSession(rawIndex, new Map(records));
    if (!loaded) throw new Error('nothing was read');
    return loaded;
  }
  const ids = (loaded: LoadedSession) => loaded.session.tabs.map((t) => t.id);
  const unopenedIds = (loaded: LoadedSession) => loaded.unopened.map((t) => [t.id, t.reason]);

  it('reads nothing when nothing is stored', () => {
    expect(readSession(undefined, new Map())).toBeNull();
  });

  it('restores every tab in index order with the stored active tab', () => {
    const loaded = read(index('b', 'a', 'b'), [
      ['a', record],
      ['b', record],
    ]);
    expect(loaded.session.activeId).toBe('b');
    expect(loaded.session.tabs.map((t) => [t.id, t.name, t.file])).toEqual([
      ['a', 'A', file],
      ['b', 'B', file],
    ]);
    expect(loaded).toMatchObject({ unopened: [], recovered: 0, missing: 0, indexDamaged: false, repair: false });
  });

  it('keeps the copies it cannot open, newer and damaged, with when they were stored', () => {
    const damaged = { savedAt: 5, file: 'damaged' };
    const outOfRange = { savedAt: 1e300, file: 'damaged' };
    const loaded = read(index('a', 'a', 'b', 'c', 'd', 'e', 'f'), [
      ['a', record],
      ['b', damaged],
      ['c', 'not a record'],
      ['d', undefined],
      ['e', newerRecord],
      ['f', outOfRange],
    ]);
    expect(ids(loaded)).toEqual(['a']);
    expect(loaded.unopened).toEqual([
      { ...entry('b', 'B'), reason: 'damaged', savedAt: 5, record: damaged },
      { ...entry('c', 'C'), reason: 'damaged', savedAt: null, record: 'not a record' },
      { ...entry('d', 'D'), reason: 'damaged', savedAt: null, record: undefined },
      { ...entry('e', 'E'), reason: 'newer', savedAt: 1, record: newerRecord },
      { ...entry('f', 'F'), reason: 'damaged', savedAt: null, record: outOfRange },
    ]);
    expect(loaded.missing).toBe(0);
    expect(loaded.repair).toBe(false);
  });

  it('drops the entries whose record is missing, and repairs the index', () => {
    const loaded = read(index('b', 'a', 'b'), [['a', record]]);
    expect(ids(loaded)).toEqual(['a']);
    expect(loaded.session.activeId).toBe('a');
    expect(loaded.unopened).toEqual([]);
    expect(loaded.missing).toBe(1);
    expect(loaded.repair).toBe(true);
  });

  it('repairs an index with malformed entries', () => {
    const raw = { ...index('a', 'a'), tabs: [entry('a'), null] };
    expect(read(raw, [['a', record]]).repair).toBe(true);
  });

  it('restores the records no entry points to after the indexed tabs, oldest first, as unsaved projects', () => {
    const loaded = read(index('a', 'a'), [
      ['late', storedAt(30)],
      ['a', storedAt(50)],
      ['undated', { file }],
      ['early', storedAt(10)],
      ['newer', { ...newerRecord, savedAt: 20 }],
    ]);
    expect(loaded.session.tabs.map((t) => [t.id, t.name, t.dirty])).toEqual([
      ['a', 'A', false],
      ['early', '', true],
      ['late', '', true],
      ['undated', '', true],
    ]);
    expect(loaded.session.activeId).toBe('a');
    expect(unopenedIds(loaded)).toEqual([['newer', 'newer']]);
    expect(loaded.unopened[0]).toMatchObject({ name: '', dirty: true });
    expect(loaded.recovered).toBe(3);
    expect(loaded.repair).toBe(true);
  });

  it('restores every readable record of a damaged index and keeps the unreadable ones', () => {
    const loaded = read({ version: SESSION_VERSION, tabs: 'damaged' }, [
      ['b', storedAt(2)],
      ['a', storedAt(1)],
      ['x', { savedAt: 3, file: null }],
      ['n', newerRecord],
    ]);
    expect(loaded.session.tabs.map((t) => [t.id, t.name, t.dirty])).toEqual([
      ['a', '', true],
      ['b', '', true],
    ]);
    expect(loaded.session.activeId).toBe('a');
    expect(unopenedIds(loaded)).toEqual([
      ['n', 'newer'],
      ['x', 'damaged'],
    ]);
    expect(loaded).toMatchObject({ recovered: 2, missing: 0, indexDamaged: true, repair: true });
  });

  it('restores the records when no index is stored', () => {
    const loaded = read(undefined, [['a', record]]);
    expect(ids(loaded)).toEqual(['a']);
    expect(loaded).toMatchObject({ recovered: 1, indexDamaged: false, repair: true });
  });

  it('refuses an index from a newer version, whatever the records hold', () => {
    const records = new Map([['a', record]]);
    expect(errorOf(() => readSession({ version: SESSION_VERSION + 1 }, records)).message).toBe(SESSION_NEWER);
  });

  it('keeps the held tabs unopened, with their records as stored, and restores the others', () => {
    const held = new Set(['b', 'late', 'n', 'gone']);
    const loaded = readSession(
      index('b', 'a', 'b', 'n'),
      new Map<string, unknown>([
        ['a', record],
        ['b', storedAt(7)],
        ['n', newerRecord],
        ['late', storedAt(30)],
        ['early', storedAt(10)],
      ]),
      held,
    );
    if (!loaded) throw new Error('nothing was read');
    expect(loaded.session.tabs.map((t) => [t.id, t.name, t.dirty])).toEqual([
      ['a', 'A', false],
      ['early', '', true],
    ]);
    expect(loaded.session.activeId).toBe('a');
    expect(loaded.unopened).toEqual([
      { ...entry('b', 'B'), reason: 'interrupted', savedAt: 7, record: storedAt(7) },
      { ...entry('n', 'N'), reason: 'newer', savedAt: 1, record: newerRecord },
      { ...entry('late', '', true), reason: 'interrupted', savedAt: 30, record: storedAt(30) },
    ]);
    expect(loaded).toMatchObject({ recovered: 1, missing: 0 });
  });

  it('shows no tab when every tab is held', () => {
    const loaded = readSession(index('a', 'a'), new Map([['a', record]]), new Set(['a']));
    expect(loaded?.session).toEqual({ activeId: '', tabs: [] });
    expect(loaded?.unopened.map((t) => [t.id, t.reason])).toEqual([['a', 'interrupted']]);
  });

  it('shows no tab when none is restored', () => {
    const empty = read(index('a', 'a'), [['a', newerRecord]]);
    expect(empty.session).toEqual({ activeId: '', tabs: [] });
    expect(unopenedIds(empty)).toEqual([['a', 'newer']]);
  });

  it('says that a damaged list was recovered from the stored copies, and what to do', () => {
    expect(SESSION_DAMAGED).toMatch(/damaged.*stored copies\. Check them and save them to files\.$/);
  });
});

describe('buildIndex', () => {
  it('lists the open tabs in tab order, then the unopened entries that are not open', () => {
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

describe('unopenedFileText', () => {
  it('writes the project as stored', () => {
    expect(JSON.parse(unopenedFileText(newerRecord))).toEqual(newerRecord.file);
  });

  it('writes the whole record when it holds no project', () => {
    for (const raw of [{ savedAt: 1, file: 'x' }, { savedAt: 1 }, 'text', [1, 2], null]) {
      expect(JSON.parse(unopenedFileText(raw))).toEqual(raw);
    }
    expect(unopenedFileText(undefined)).toBe('null');
  });

  it('refuses a record that cannot be written as JSON, and says to delete it', () => {
    expect(errorOf(() => unopenedFileText({ savedAt: 1, file: { size: 1n } })).message).toBe(COPY_UNWRITABLE);
  });

  it('refuses a copy whose artwork is over the project limit before joining the text, and keeps it', () => {
    // Five slots share one string of 100 MB less the name: 500 MB of artwork, but only 100 MB of memory.
    const dataUrl = 'A'.repeat(100_000_000 - 'a.png'.length);
    const artwork = { box: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((s) => [s, { name: 'a.png', dataUrl }])) };
    const stringify = vi.spyOn(JSON, 'stringify');
    const error = errorOf(() => unopenedFileText({ savedAt: 1, file: { ...newerRecord.file, artwork } }));
    expect(error.message).toBe(copyTooLarge(500_000_000));
    expect(error.message).toBe(
      'The copy is too large to save as a project file: 500 MB, more than the 400 MB a project can hold. It is kept: Mockup Director offers it again at every start.',
    );
    expect(stringify).not.toHaveBeenCalled();
  });

  it('refuses a copy whose text is over the project limit, and keeps it', () => {
    vi.spyOn(JSON, 'stringify').mockReturnValue({ length: MAX_PROJECT_SIZE + 1 } as unknown as string);
    expect(errorOf(() => unopenedFileText(newerRecord)).message).toBe(copyTooLarge(MAX_PROJECT_SIZE + 1));
  });

  it('turns the engine’s string limit into a message that keeps the copy', () => {
    const failure = new RangeError('Invalid string length');
    vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw failure;
    });
    const error = errorOf(() => unopenedFileText(newerRecord));
    expect(error.message).toBe(
      'The copy is too large to save as a project file. It is kept: Mockup Director offers it again at every start.',
    );
    expect(error.cause).toBe(failure);
  });

  it('never advises deleting a copy that is too large', () => {
    for (const message of [copyTooLarge(), copyTooLarge(MAX_PROJECT_SIZE + 1)])
      expect(message).not.toMatch(/[Dd]elete/);
  });
});

describe('unopenedFileName', () => {
  it('names the file after the tab, or a recovered project when the tab has no name', () => {
    expect(unopenedFileName('Tea box')).toBe('Tea box.mdproj');
    expect(unopenedFileName('')).toBe('Recovered project.mdproj');
    expect(unopenedFileName(' / ')).toBe('Recovered project.mdproj');
  });

  it('leaves out characters a file name cannot hold', () => {
    expect(unopenedFileName('a/b:c*?"<>|\u0001d')).toBe('a b c d.mdproj');
  });
});
