/** The DOM helpers that run without a document: unique ids, the observable value and work coalesced per frame. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Signal, frameCoalescer, nextId } from '../../src/ui/dom';

describe('nextId', () => {
  it('gives a new id with the prefix on every call', () => {
    const [a, b] = [nextId('field'), nextId('field')];
    expect(a).toMatch(/^field-\d+$/);
    expect(b).toMatch(/^field-\d+$/);
    expect(a).not.toBe(b);
    expect(nextId()).toMatch(/^cb-\d+$/);
  });
});

describe('Signal', () => {
  it('holds its value and tells subscribers of each new one until they unsubscribe', () => {
    const signal = new Signal(1);
    const seen: number[] = [];
    const unsubscribe = signal.subscribe((v) => seen.push(v));
    signal.set(2);
    expect(signal.value).toBe(2);
    unsubscribe();
    signal.set(3);
    expect(signal.value).toBe(3);
    expect(seen).toEqual([2]);
  });
});

describe('frameCoalescer', () => {
  let frames: (() => void)[];

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('runs many requests once, in the next frame', () => {
    const fn = vi.fn();
    const coalescer = frameCoalescer(fn);
    coalescer.schedule();
    coalescer.schedule();
    expect(fn).not.toHaveBeenCalled();
    for (const frame of frames) frame();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs after a timeout when no frame comes, as in a hidden window', () => {
    const fn = vi.fn();
    frameCoalescer(fn).schedule();
    vi.advanceTimersByTime(120);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs a pending request at once on flush, and nothing when none is pending', () => {
    const fn = vi.fn();
    const coalescer = frameCoalescer(fn);
    coalescer.flush();
    expect(fn).not.toHaveBeenCalled();
    coalescer.schedule();
    coalescer.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    for (const frame of frames) frame();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
