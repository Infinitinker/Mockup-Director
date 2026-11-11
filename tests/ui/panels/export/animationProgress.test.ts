/** Tests what the Export tab's animation progress says in each phase and how far its bar goes. */
import { describe, expect, it } from 'vitest';
import { describeProgress } from '../../../../src/ui/panels/export/animationProgress';

describe('describeProgress', () => {
  it('prepares at 0', () => {
    expect(describeProgress({ phase: 'prepare', done: 0, total: 0 })).toEqual({ text: 'Preparing…', fraction: 0 });
  });

  it('analyzes the colors in the first tenth', () => {
    expect(describeProgress({ phase: 'palette', done: 5, total: 10 })).toEqual({
      text: 'Analyzing colors: 5 / 10',
      fraction: 0.05,
    });
    expect(describeProgress({ phase: 'palette', done: 0, total: 0 }).fraction).toBe(0);
  });

  it('renders and encodes the frames up to 95 %', () => {
    const half = describeProgress({ phase: 'frames', done: 10, total: 20 });
    expect(half.text).toBe('Frames rendered & encoded: 10 / 20');
    expect(half.fraction).toBeCloseTo(0.525);
    expect(describeProgress({ phase: 'frames', done: 20, total: 20 }).fraction).toBeCloseTo(0.95);
    expect(describeProgress({ phase: 'frames', done: 0, total: 0 }).fraction).toBe(0.1);
  });

  it('finishes the file at 95 %, then 100 %', () => {
    expect(describeProgress({ phase: 'finalize', done: 0, total: 1 })).toEqual({
      text: 'Finishing the file…',
      fraction: 0.95,
    });
    expect(describeProgress({ phase: 'finalize', done: 1, total: 1 }).fraction).toBe(1);
  });
});
