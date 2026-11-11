/**
 * Tests the batch runner in src/export/batch/index.ts: the names and order of the stills in the ZIP file, the
 * progress before each item, warnings, failing items, the ZIP size limit, Cancel, the host's end, and when the
 * temporary models and their resources are let go.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ExportFormat } from '../../../src/core/types/export';
import { UserError } from '../../../src/core/errors';
import { runBatch, type BatchCallbacks, type BatchItem, type RenderedItem } from '../../../src/export/batch';
import { ZipLimitError } from '../../../src/export/zip';
import { SizedBlob } from '../sizedBlob';
import { readZip } from '../zipReader';
import { fakeStage } from './fakeStage';

const bytes = (text: string) => new TextEncoder().encode(text);

/** An item that renders `text` as a still in `format`. */
function item(label: string, slug: string, text = label, format: ExportFormat = 'png'): BatchItem {
  return { label, slug, render: async () => ({ blob: new Blob([bytes(text)]), format }) };
}

/** A host whose begin and end go to the event log. */
function fakeHost(events: string[]) {
  return {
    begin: vi.fn(() => {
      events.push('begin');
      return true;
    }),
    end: vi.fn(() => {
      events.push('end');
    }),
  };
}

/** Callbacks that log progress and frames to `events`; `canceled` answers isCanceled before each item. */
function callbacks(events: string[], canceled: (asked: number) => boolean = () => false): BatchCallbacks {
  let asked = 0;
  return {
    onProgress: (index, label) => events.push(`progress ${index} ${label}`),
    isCanceled: () => canceled(asked++),
    nextFrame: async () => {
      events.push('frame');
    },
    describeError: (label, error) => `${label}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

/** Runs the items on a fake stage and host; returns the result, the event log and the host. */
async function run(items: BatchItem[], cb?: (events: string[]) => BatchCallbacks) {
  const events: string[] = [];
  const host = fakeHost(events);
  const { stage } = fakeStage(events);
  const result = await runBatch(items, host, stage, cb ? cb(events) : callbacks(events));
  return { result, events, host };
}

const entriesOf = async (zip: { finish(): Blob }) =>
  readZip(new Uint8Array(await zip.finish().arrayBuffer())).entries.map((e) => [
    e.name,
    new TextDecoder().decode(e.data),
  ]);

describe('runBatch', () => {
  it('packs every item in order, numbered, with the extension of its format', async () => {
    const { result, host } = await run([item('A', 'a'), item('B', 'b', 'bee', 'jpeg'), item('C', 'c', 'sea', 'webp')]);
    expect(await entriesOf(result.zip)).toEqual([
      ['01-a.png', 'A'],
      ['02-b.jpg', 'bee'],
      ['03-c.webp', 'sea'],
    ]);
    expect(result).toMatchObject({ total: 3, done: 3, errors: [], warnings: [], canceled: false, limitHit: false });
    expect(host.end).toHaveBeenCalledTimes(1);
  });

  it('pads the number to the item count, with at least two digits', async () => {
    const nine = await run(Array.from({ length: 9 }, (_, i) => item(`${i}`, 'x')));
    expect((await entriesOf(nine.result.zip)).map(([name]) => name)).toEqual(
      Array.from({ length: 9 }, (_, i) => `0${i + 1}-x.png`),
    );
    const hundred = await run(Array.from({ length: 100 }, (_, i) => item(`${i}`, 'x')));
    const names = (await entriesOf(hundred.result.zip)).map(([name]) => name);
    expect(names[0]).toBe('001-x.png');
    expect(names[99]).toBe('100-x.png');
  });

  it('reports the progress before each item and waits for a frame before rendering it', async () => {
    const events: string[] = [];
    const logged = (label: string): BatchItem => ({
      label,
      slug: label,
      render: async () => {
        events.push(`render ${label}`);
        return { blob: new Blob([bytes(label)]), format: 'png' };
      },
    });
    const host = fakeHost(events);
    await runBatch([logged('a'), logged('b')], host, fakeStage(events).stage, callbacks(events));
    expect(events).toEqual(['progress 0 a', 'frame', 'render a', 'progress 1 b', 'frame', 'render b', 'end']);
  });

  it('keeps an item with a warning and reports the warning', async () => {
    const warned: BatchItem = {
      label: 'W',
      slug: 'w',
      render: async () => ({ blob: new Blob([bytes('w')]), format: 'png', warning: 'Parts were left out.' }),
    };
    const { result } = await run([warned, item('B', 'b')]);
    expect(result.done).toBe(2);
    expect(result.warnings).toEqual([{ label: 'W', message: 'Parts were left out.' }]);
  });

  it('reports a failing item with the message describeError gives, and goes on', async () => {
    const failure = new UserError('The artwork could not be read.');
    const failing: BatchItem = { label: 'F', slug: 'f', render: () => Promise.reject(failure) };
    const describeError = vi.fn(() => 'shown message');
    const { result } = await run([item('A', 'a'), failing, item('C', 'c')], (events) => ({
      ...callbacks(events),
      describeError,
    }));
    expect(describeError).toHaveBeenCalledExactlyOnceWith('F', failure);
    expect(result.errors).toEqual([{ label: 'F', message: 'shown message' }]);
    expect(result.done).toBe(2);
    expect((await entriesOf(result.zip)).map(([name]) => name)).toEqual(['01-a.png', '03-c.png']);
  });

  it('stops at the ZIP limit with its own message, keeping what is done', async () => {
    const huge: BatchItem = {
      label: 'H',
      slug: 'h',
      render: async () => ({ blob: new SizedBlob(0xffffffff), format: 'png' }),
    };
    const after = { ...item('C', 'c'), render: vi.fn(item('C', 'c').render) };
    const describeError = vi.fn(() => 'not this message');
    const { result, host } = await run([item('A', 'a'), huge, after], (events) => ({
      ...callbacks(events),
      describeError,
    }));
    expect(describeError).toHaveBeenCalledOnce();
    expect(result.limitHit).toBe(true);
    expect(result.errors).toEqual([{ label: 'H', message: new ZipLimitError().message }]);
    expect(after.render).not.toHaveBeenCalled();
    expect(result.done).toBe(1);
    expect((await entriesOf(result.zip)).map(([name]) => name)).toEqual(['01-a.png']);
    expect(host.end).toHaveBeenCalledOnce();
  });

  it('asks for Cancel before every item and stops before the next one', async () => {
    const second = { ...item('B', 'b'), render: vi.fn(item('B', 'b').render) };
    const { result, host } = await run([item('A', 'a'), second], (events) => callbacks(events, (asked) => asked === 1));
    expect(result).toMatchObject({ canceled: true, done: 1, total: 2 });
    expect(second.render).not.toHaveBeenCalled();
    expect(host.end).toHaveBeenCalledOnce();

    const first = { ...item('A', 'a'), render: vi.fn(item('A', 'a').render) };
    const none = await run([first], (events) => callbacks(events, () => true));
    expect(none.result).toMatchObject({ canceled: true, done: 0 });
    expect(first.render).not.toHaveBeenCalled();
    expect(none.host.end).toHaveBeenCalledOnce();
  });

  it('ends the host when the progress throws, and rejects', async () => {
    const events: string[] = [];
    const host = fakeHost(events);
    const failure = new Error('progress failed');
    const cb = {
      ...callbacks(events),
      onProgress: () => {
        throw failure;
      },
    };
    await expect(runBatch([item('A', 'a')], host, fakeStage(events).stage, cb)).rejects.toBe(failure);
    expect(host.end).toHaveBeenCalledOnce();
  });

  it('shows the next model before disposing the last one, and disposes the last one after the end', async () => {
    const events: string[] = [];
    const shows = (name: string): BatchItem => ({
      label: name,
      slug: name,
      render: async (r): Promise<RenderedItem> => {
        const object = new THREE.Group();
        object.name = name;
        r.showModel(object, () => events.push(`dispose ${name}`));
        return { blob: new Blob([bytes(name)]), format: 'png' };
      },
    });
    const cb = { ...callbacks([]), nextFrame: async () => {} };
    await runBatch([shows('o1'), shows('o2')], fakeHost(events), fakeStage(events).stage, cb);
    expect(events).toEqual(['setModel o1', 'setModel o2', 'dispose o1', 'end', 'dispose o2']);
  });

  it('goes on when disposing throws', async () => {
    const events: string[] = [];
    const throwing = (name: string): BatchItem => ({
      label: name,
      slug: name,
      render: async (r) => {
        r.showModel(new THREE.Group(), () => {
          throw new Error(`dispose ${name} failed`);
        });
        return { blob: new Blob([bytes(name)]), format: 'png' };
      },
    });
    const host = fakeHost(events);
    const result = await runBatch([throwing('a'), throwing('b')], host, fakeStage(events).stage, callbacks([]));
    expect(result.done).toBe(2);
    expect(result.errors).toEqual([]);
    expect(host.end).toHaveBeenCalledOnce();
  });

  it('ends an empty batch at once', async () => {
    const { result, host, events } = await run([]);
    expect(result).toMatchObject({ total: 0, done: 0, canceled: false });
    expect(events).toEqual(['end']);
    expect(host.end).toHaveBeenCalledOnce();
  });
});
