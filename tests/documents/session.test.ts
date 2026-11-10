/**
 * Tests the bookkeeping of the session saver in src/documents/session.ts, with a fake store: which tab
 * records it writes and deletes, the unopened entries and forgetting them, and saves requested while one runs.
 */
import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '../../src/documents/tabs';
import { SessionSaver, type SessionStore, type TabPut } from '../../src/documents/session';
import type { IndexRecord } from '../../src/documents/sessionRecords';
import { documentState } from '../fixtures';

interface Write {
  index: IndexRecord;
  puts: string[];
  deletes: string[];
}

/** A store that records each write; `hold` makes the next writes wait until `release`, `fail` rejects them. */
class FakeStore implements SessionStore {
  writes: Write[] = [];
  fail = false;
  private held: (() => void)[] = [];
  hold = false;

  write(index: IndexRecord, puts: readonly TabPut[], deletes: readonly string[]): Promise<void> {
    this.writes.push({ index, puts: puts.map((p) => p.id), deletes: [...deletes] });
    if (this.fail) return Promise.reject(new Error('write failed'));
    if (!this.hold) return Promise.resolve();
    return new Promise((resolve) => this.held.push(resolve));
  }

  release(): void {
    this.hold = false;
    for (const resolve of this.held.splice(0)) resolve();
  }
}

const tab = (id: string, revision = 1): TabSnapshot => ({
  id,
  name: id.toUpperCase(),
  dirty: false,
  revision,
  state: documentState('box'),
});
const kept = { id: 'k', name: 'Kept', dirty: true };
const other = { id: 'o', name: '', dirty: true };
const ids = (w: Write) => w.index.tabs.map((t) => t.id);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SessionSaver', () => {
  it('lists the unopened entries in every index, after the open tabs, and never deletes their records by itself', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt(['a'], [kept]);
    await saver.save([tab('a')], 'a');
    await saver.save([tab('a'), tab('b')], 'b');
    await saver.save([tab('b')], 'b');
    await saver.save([], '');
    expect(store.writes.map(ids)).toEqual([['a', 'k'], ['a', 'b', 'k'], ['b', 'k'], ['k']]);
    expect(store.writes.flatMap((w) => w.deletes)).not.toContain('k');
    expect(store.writes.flatMap((w) => w.puts)).not.toContain('k');
  });

  it('deletes adopted records that are not open once, at the first save', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt(['a', 'closed'], []);
    await saver.save([tab('a')], 'a');
    await saver.save([tab('a', 2)], 'a');
    expect(store.writes.map((w) => w.deletes)).toEqual([['closed'], []]);
  });

  it('deletes the record of a restored tab when it is closed', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt(['r'], []);
    await saver.save([tab('r'), tab('n')], 'r');
    await saver.save([tab('n')], 'n');
    expect(store.writes[1].deletes).toEqual(['r']);
  });

  it('writes a record only when its tab changed since it was written', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    await saver.save([tab('a'), tab('b')], 'a');
    await saver.save([tab('a'), tab('b', 2)], 'a');
    await saver.save([tab('a'), tab('b', 2)], 'b');
    expect(store.writes.map((w) => w.puts)).toEqual([['a', 'b'], ['b'], []]);
  });

  it('merges the saves requested while one runs into one write of the latest tabs', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    store.hold = true;
    const first = saver.save([tab('a')], 'a');
    await settle();
    const second = saver.save([tab('a', 2)], 'a');
    const third = saver.save([tab('a', 3), tab('b')], 'b');
    expect(second).toBe(third);
    store.release();
    await expect(Promise.all([first, second, third])).resolves.toBeDefined();
    expect(store.writes.map((w) => [ids(w), w.puts])).toEqual([
      [['a'], ['a']],
      [
        ['a', 'b'],
        ['a', 'b'],
      ],
    ]);
  });

  it('writes a tab again when an undo during a save brings back the revision written before', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    await saver.save([tab('x', 4)], 'x');
    store.hold = true;
    const writing5 = saver.save([tab('x', 5)], 'x');
    await settle();
    const back4 = saver.save([tab('x', 4)], 'x');
    store.release();
    await Promise.all([writing5, back4]);
    expect(store.writes.map((w) => w.puts)).toEqual([['x'], ['x'], ['x']]);
  });

  it('retries the same writes and deletes after a write failed', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt(['old'], []);
    store.fail = true;
    await expect(saver.save([tab('a')], 'a')).rejects.toThrow('write failed');
    store.fail = false;
    await saver.save([tab('a')], 'a');
    expect(store.writes.map((w) => [w.puts, w.deletes])).toEqual([
      [['a'], ['old']],
      [['a'], ['old']],
    ]);
  });

  it('forgets an unopened entry: leaves it out of the index and deletes exactly its record, once', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt(['a'], [kept, other]);
    await saver.save([tab('a')], 'a');
    await saver.forget('k', [tab('a')], 'a');
    await saver.save([tab('a', 2)], 'a');
    expect(store.writes.map((w) => [ids(w), w.deletes])).toEqual([
      [['a', 'k', 'o'], []],
      [['a', 'o'], ['k']],
      [['a', 'o'], []],
    ]);
  });

  it('keeps an entry whose forgetting failed, in this and every later index', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt([], [kept]);
    store.fail = true;
    await expect(saver.forget('k', [tab('a')], 'a')).rejects.toThrow('write failed');
    store.fail = false;
    await saver.save([tab('a')], 'a');
    await saver.save([], '');
    expect(store.writes.map((w) => [ids(w), w.deletes])).toEqual([
      [['a'], ['k']],
      [['a', 'k'], []],
      [['k'], ['a']],
    ]);
  });

  it('forgets an entry asked for during a write in the next write, and asking again waits for it', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt([], [kept]);
    store.hold = true;
    const running = saver.save([tab('a')], 'a');
    await settle();
    const forgotten = saver.forget('k', [tab('a')], 'a');
    expect(saver.forget('k', [tab('a')], 'a')).toBe(forgotten);
    store.release();
    await Promise.all([running, forgotten]);
    expect(store.writes.map((w) => [ids(w), w.deletes])).toEqual([
      [['a', 'k'], []],
      [['a'], ['k']],
    ]);
  });

  it('forgets only unopened entries', async () => {
    const store = new FakeStore();
    const saver = new SessionSaver(store);
    saver.adopt(['a'], [kept]);
    await saver.forget('a', [tab('a')], 'a');
    expect(store.writes).toEqual([]);
  });
});
