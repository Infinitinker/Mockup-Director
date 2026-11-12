/**
 * Tests the turntable motion in src/export/animation/turntable.ts: the product angle of every
 * frame for a full turn and for a swing (sine and linear easing, both directions), and the
 * per-frame delays whose rounding errors are carried over.
 */
import { describe, expect, it } from 'vitest';
import type { AnimationSettings } from '../../../src/core/types/export';
import { frameCountOf, normalizeAnimationSettings } from '../../../src/export/animation/settings';
import { frameDelays, turntableAngles } from '../../../src/export/animation/turntable';
import { randomInt, seededRandom } from '../../random';

type Motion = Pick<AnimationSettings, 'fps' | 'duration' | 'motion' | 'swingAngle' | 'direction' | 'easing'>;

/**
 * Whether two angles agree to 9 decimal places, as `toBeCloseTo(expected, 9)` checks. The random
 * runs check every frame this way and expect once per run: an expect per frame makes them slow.
 */
const closeTo = (actual: number, expected: number) => Math.abs(actual - expected) < 5e-10;

const motion = (overrides: Partial<Motion>): Motion => ({
  fps: 2,
  duration: 4,
  motion: 'loop',
  swingAngle: 30,
  direction: 'ccw',
  easing: 'sine',
  ...overrides,
});

describe('turntableAngles, full turn', () => {
  it('turns at constant speed and leaves out the frame that would repeat the first', () => {
    expect(turntableAngles(motion({ fps: 2, duration: 4 }))).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('turns clockwise with negative angles', () => {
    expect(turntableAngles(motion({ fps: 1, duration: 4, direction: 'cw' }))).toEqual([0, -90, -180, -270]);
  });

  it('starts at exactly 0, never -0', () => {
    for (const direction of ['cw', 'ccw'] as const) {
      for (const kind of ['loop', 'swing'] as const) {
        expect(Object.is(turntableAngles(motion({ direction, motion: kind }))[0], 0)).toBe(true);
      }
    }
  });

  it('has one frame per frame count, evenly spaced within one turn', () => {
    const random = seededRandom(1);
    for (let run = 0; run < 200; run++) {
      const s = motion({
        fps: randomInt(random, 1, 60),
        duration: randomInt(random, 10, 200) / 10,
        direction: random() < 0.5 ? 'cw' : 'ccw',
      });
      const angles = turntableAngles(s);
      const n = frameCountOf(s);
      const sign = s.direction === 'cw' ? -1 : 1;
      expect(angles).toHaveLength(n);
      const wrong = angles.flatMap((angle, k) =>
        angle * sign >= 0 && angle * sign < 360 && closeTo(angle, (sign * 360 * k) / n) ? [] : [{ k, angle }],
      );
      expect(wrong, JSON.stringify(s)).toEqual([]);
    }
  });
});

describe('turntableAngles, swing', () => {
  it('follows a sine between -A and +A', () => {
    const angles = turntableAngles(motion({ fps: 2, duration: 4, motion: 'swing', swingAngle: 40 }));
    const expected = [0, 40 * Math.SQRT1_2, 40, 40 * Math.SQRT1_2, 0, -40 * Math.SQRT1_2, -40, -40 * Math.SQRT1_2];
    expect(angles).toHaveLength(expected.length);
    angles.forEach((angle, k) => {
      expect(angle).toBeCloseTo(expected[k], 9);
    });
  });

  it('follows a triangle wave with linear easing', () => {
    const angles = turntableAngles(motion({ fps: 2, duration: 4, motion: 'swing', swingAngle: 40, easing: 'linear' }));
    const expected = [0, 20, 40, 20, 0, -20, -40, -20];
    angles.forEach((angle, k) => {
      expect(angle).toBeCloseTo(expected[k], 9);
    });
  });

  it('mirrors the angles for clockwise swings', () => {
    for (const easing of ['sine', 'linear'] as const) {
      const ccw = turntableAngles(motion({ motion: 'swing', easing, fps: 7, duration: 3 }));
      const cw = turntableAngles(motion({ motion: 'swing', easing, fps: 7, duration: 3, direction: 'cw' }));
      cw.forEach((angle, k) => {
        expect(angle).toBeCloseTo(-ccw[k], 12);
      });
    }
  });

  it('stays within the swing angle and loops seamlessly back to the start view', () => {
    const random = seededRandom(2);
    for (let run = 0; run < 300; run++) {
      const s = motion({
        fps: randomInt(random, 1, 60),
        duration: randomInt(random, 10, 200) / 10,
        motion: 'swing',
        swingAngle: randomInt(random, 1, 180),
        direction: random() < 0.5 ? 'cw' : 'ccw',
        easing: random() < 0.5 ? 'sine' : 'linear',
      });
      const angles = turntableAngles(s);
      const n = angles.length;
      expect(n).toBe(frameCountOf(s));
      const wrong = angles.flatMap((angle, k) =>
        Math.abs(angle) <= s.swingAngle + 1e-9 && (k === 0 || closeTo(angle + angles[n - k], 0)) ? [] : [{ k, angle }],
      );
      expect(wrong, JSON.stringify(s)).toEqual([]);
      if (n % 4 === 0) {
        expect(Math.max(...angles.map(Math.abs))).toBeCloseTo(s.swingAngle, 9);
      }
    }
  });
});

describe('turntableAngles with normalized settings', () => {
  it('gives finite angles for any settings', () => {
    const random = seededRandom(3);
    for (let run = 0; run < 300; run++) {
      const s = normalizeAnimationSettings({
        fps: randomInt(random, -10, 100),
        duration: random() * 30,
        motion: random() < 0.5 ? 'loop' : 'swing',
        swingAngle: randomInt(random, -10, 400),
        direction: random() < 0.5 ? 'cw' : 'ccw',
        easing: random() < 0.5 ? 'sine' : 'linear',
      });
      const angles = turntableAngles(s);
      expect(angles.length).toBeGreaterThanOrEqual(2);
      expect(
        angles.filter((angle) => !Number.isFinite(angle)),
        JSON.stringify(s),
      ).toEqual([]);
    }
  });
});

describe('frameDelays', () => {
  it('carries rounding errors over so the total length stays exact', () => {
    expect(frameDelays(6, 30, 100)).toEqual([3, 4, 3, 3, 4, 3]);
    expect(frameDelays(4, 20, 100)).toEqual([5, 5, 5, 5]);
    expect(frameDelays(3, 30, 1000)).toEqual([33, 34, 33]);
  });

  it('treats a frame rate below 1 as 1', () => {
    expect(frameDelays(2, 0, 100)).toEqual([100, 100]);
    expect(frameDelays(2, -5, 1000)).toEqual([1000, 1000]);
  });

  it('never gives a delay shorter than one unit', () => {
    expect(frameDelays(4, 300, 100)).toEqual([1, 1, 1, 1]);
  });

  it('gives no delays for no frames', () => {
    expect(frameDelays(0, 30, 100)).toEqual([]);
  });

  it('sums to the exact length and differs from the ideal delay by less than one unit', () => {
    const random = seededRandom(4);
    for (let run = 0; run < 500; run++) {
      const count = randomInt(random, 1, 600);
      const fps = randomInt(random, 1, 60);
      const units = random() < 0.5 ? 100 : 1000;
      const delays = frameDelays(count, fps, units);
      const step = units / fps;
      expect(delays).toHaveLength(count);
      expect(delays.reduce((sum, d) => sum + d, 0)).toBe(Math.round(count * step));
      const wrong = delays.filter((d) => !Number.isInteger(d) || Math.abs(d - step) >= 1);
      expect(wrong, `${count} frames at ${fps} fps in units of 1/${units} s`).toEqual([]);
    }
  });
});
