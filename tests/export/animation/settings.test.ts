/**
 * Tests the animation settings in src/export/animation/settings.ts: the limits per format, the
 * normalization of untrusted settings (types, ranges, size and aspect ratio, formats that are not
 * available), the frame count and the encoded size.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANIMATION,
  DEFAULT_GIF_FPS,
  DEFAULT_VIDEO_FPS,
  MAX_ANIMATION_DURATION,
  MAX_ANIMATION_FPS,
  MAX_ANIMATION_SIZE,
  MAX_VIDEO_FPS,
  MAX_VIDEO_SIZE,
  MIN_ANIMATION_DURATION,
  MIN_ANIMATION_SIZE,
} from '../../../src/core/defaults';
import type { AnimationFormat, AnimationSettings } from '../../../src/core/types/export';
import {
  defaultFpsFor,
  frameCountOf,
  maxFpsFor,
  maxMarginFor,
  maxSizeFor,
  normalizeAnimationSettings,
  outputSizeOf,
} from '../../../src/export/animation/settings';
import { randomInt, seededRandom } from '../../random';

const FORMATS: AnimationFormat[] = ['gif', 'webp', 'mp4'];

/** The allowed values of every select-like setting. */
const CHOICES = {
  format: FORMATS,
  motion: ['loop', 'swing'],
  direction: ['cw', 'ccw'],
  easing: ['sine', 'linear'],
  background: ['transparent', 'scene'],
  dither: ['floyd', 'ordered', 'none'],
  palette: ['global', 'frame'],
  quality: ['low', 'medium', 'high'],
} as const;

/** A value of a random type: valid choices, junk strings, numbers of any range, booleans, objects. */
function randomValue(random: () => number, choices: readonly string[]): unknown {
  const options: unknown[] = [
    choices[randomInt(random, 0, choices.length - 1)],
    (random() - 0.3) * 10 ** randomInt(random, 0, 5),
    randomInt(random, -100, 5000),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    'junk',
    '800',
    random() < 0.5,
    null,
    undefined,
    {},
    [],
  ];
  return options[randomInt(random, 0, options.length - 1)];
}

function randomRaw(random: () => number): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_ANIMATION)) {
    raw[key] = randomValue(random, key in CHOICES ? CHOICES[key as keyof typeof CHOICES] : []);
  }
  raw.unknown = 'dropped';
  return raw;
}

function randomAvailability(random: () => number): Partial<Record<AnimationFormat, boolean>> {
  const available: Partial<Record<AnimationFormat, boolean>> = {};
  for (const format of FORMATS) {
    const pick = randomInt(random, 0, 2);
    if (pick < 2) available[format] = pick === 1;
  }
  return available;
}

describe('format limits', () => {
  it('allows larger sizes and higher frame rates for MP4', () => {
    expect(maxSizeFor('gif')).toBe(MAX_ANIMATION_SIZE);
    expect(maxSizeFor('webp')).toBe(MAX_ANIMATION_SIZE);
    expect(maxSizeFor('mp4')).toBe(MAX_VIDEO_SIZE);
    expect(maxFpsFor('gif')).toBe(MAX_ANIMATION_FPS);
    expect(maxFpsFor('webp')).toBe(MAX_ANIMATION_FPS);
    expect(maxFpsFor('mp4')).toBe(MAX_VIDEO_FPS);
    expect(defaultFpsFor('gif')).toBe(DEFAULT_GIF_FPS);
    expect(defaultFpsFor('webp')).toBe(DEFAULT_GIF_FPS);
    expect(defaultFpsFor('mp4')).toBe(DEFAULT_VIDEO_FPS);
  });

  it('keeps the default frame rates within their limits', () => {
    for (const format of FORMATS) expect(defaultFpsFor(format)).toBeLessThanOrEqual(maxFpsFor(format));
  });
});

describe('normalizeAnimationSettings', () => {
  it('keeps the defaults as they are', () => {
    expect(normalizeAnimationSettings(DEFAULT_ANIMATION)).toEqual(DEFAULT_ANIMATION);
  });

  it('gives the defaults for anything that is not an object', () => {
    for (const raw of [undefined, null, 'gif', 42, true, []]) {
      expect(normalizeAnimationSettings(raw)).toEqual(DEFAULT_ANIMATION);
    }
  });

  it('keeps valid settings of every kind', () => {
    const valid: AnimationSettings = {
      format: 'mp4',
      width: 1280,
      height: 720,
      margin: 12,
      fps: 60,
      duration: 6.5,
      motion: 'swing',
      swingAngle: 45,
      direction: 'ccw',
      easing: 'linear',
      background: 'transparent',
      dither: 'ordered',
      palette: 'frame',
      quality: 'high',
      useViewZoomPan: true,
    };
    expect(normalizeAnimationSettings(valid)).toEqual(valid);
  });

  it('replaces values of the wrong type and unknown choices with the defaults', () => {
    const settings = normalizeAnimationSettings({
      format: 'avi',
      width: '640',
      height: null,
      margin: Number.NaN,
      duration: Number.POSITIVE_INFINITY,
      motion: 'bounce',
      swingAngle: '90',
      direction: 1,
      easing: 'ease',
      background: true,
      dither: 'random',
      palette: 'local',
      quality: 'best',
      useViewZoomPan: 'yes',
    });
    expect(settings).toEqual(DEFAULT_ANIMATION);
  });

  it('drops unknown keys', () => {
    const settings = normalizeAnimationSettings({ ...DEFAULT_ANIMATION, extra: 1 });
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_ANIMATION).sort());
  });

  it('shrinks a too large size to the format limit, keeping the aspect ratio', () => {
    expect(normalizeAnimationSettings({ format: 'gif', width: 2400, height: 1200 })).toMatchObject({
      width: 1200,
      height: 600,
    });
    expect(normalizeAnimationSettings({ format: 'mp4', width: 3840, height: 2160 })).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(normalizeAnimationSettings({ format: 'webp', width: 600, height: 6000 })).toMatchObject({
      width: 120,
      height: 1200,
    });
  });

  it('raises a too small side to the smallest size on its own', () => {
    expect(normalizeAnimationSettings({ width: 5, height: 400 })).toMatchObject({
      width: MIN_ANIMATION_SIZE,
      height: 400,
    });
    expect(normalizeAnimationSettings({ width: -50, height: 0 })).toMatchObject({
      width: MIN_ANIMATION_SIZE,
      height: MIN_ANIMATION_SIZE,
    });
  });

  it('falls back to GIF when the format is not available', () => {
    expect(normalizeAnimationSettings({ format: 'webp' }, { webp: false }).format).toBe('gif');
    expect(normalizeAnimationSettings({ format: 'mp4' }, { mp4: false }).format).toBe('gif');
    expect(normalizeAnimationSettings({ format: 'mp4' }, { webp: false }).format).toBe('mp4');
    expect(normalizeAnimationSettings({ format: 'webp' }, { webp: true }).format).toBe('webp');
  });

  it('applies the limits of the format it falls back to', () => {
    const settings = normalizeAnimationSettings({ format: 'mp4', width: 1920, height: 960, fps: 60 }, { mp4: false });
    expect(settings).toMatchObject({ format: 'gif', width: 1200, height: 600, fps: MAX_ANIMATION_FPS });
  });

  it('suggests the frame rate of the format when there is none', () => {
    expect(normalizeAnimationSettings({ format: 'mp4' }).fps).toBe(DEFAULT_VIDEO_FPS);
    expect(normalizeAnimationSettings({ format: 'webp' }).fps).toBe(DEFAULT_GIF_FPS);
  });

  it('rounds the duration to tenths of a second and clamps it', () => {
    expect(normalizeAnimationSettings({ duration: 2.34 }).duration).toBe(2.3);
    expect(normalizeAnimationSettings({ duration: 2.35 }).duration).toBe(2.4);
    expect(normalizeAnimationSettings({ duration: 0.2 }).duration).toBe(MIN_ANIMATION_DURATION);
    expect(normalizeAnimationSettings({ duration: 600 }).duration).toBe(MAX_ANIMATION_DURATION);
  });

  it('limits the margin so a content box of the smallest size is left', () => {
    expect(normalizeAnimationSettings({ width: 200, height: 100, margin: 500 }).margin).toBe(34);
    expect(normalizeAnimationSettings({ margin: -5 }).margin).toBe(0);
    expect(normalizeAnimationSettings({ margin: 10.6 }).margin).toBe(11);
  });

  it('always gives complete settings within every limit, and is stable when applied again', () => {
    const random = seededRandom(1);
    for (let run = 0; run < 2000; run++) {
      const available = randomAvailability(random);
      const s = normalizeAnimationSettings(randomRaw(random), available);

      for (const [key, choices] of Object.entries(CHOICES)) {
        expect(choices).toContain(s[key as keyof typeof CHOICES]);
      }
      if (available[s.format] === false) expect(s.format).toBe('gif');
      expect(typeof s.useViewZoomPan).toBe('boolean');
      for (const value of [s.width, s.height, s.margin, s.fps, s.swingAngle])
        expect(Number.isInteger(value)).toBe(true);
      for (const side of [s.width, s.height]) {
        expect(side).toBeGreaterThanOrEqual(MIN_ANIMATION_SIZE);
        expect(side).toBeLessThanOrEqual(maxSizeFor(s.format));
      }
      expect(s.margin).toBeGreaterThanOrEqual(0);
      expect(s.margin).toBeLessThanOrEqual(maxMarginFor(s.width, s.height));
      expect(Math.min(s.width, s.height) - 2 * s.margin).toBeGreaterThanOrEqual(MIN_ANIMATION_SIZE);
      expect(s.fps).toBeGreaterThanOrEqual(1);
      expect(s.fps).toBeLessThanOrEqual(maxFpsFor(s.format));
      expect(s.duration).toBeGreaterThanOrEqual(MIN_ANIMATION_DURATION);
      expect(s.duration).toBeLessThanOrEqual(MAX_ANIMATION_DURATION);
      expect(Math.abs(s.duration * 10 - Math.round(s.duration * 10))).toBeLessThan(1e-9);
      expect(s.swingAngle).toBeGreaterThanOrEqual(1);
      expect(s.swingAngle).toBeLessThanOrEqual(180);

      expect(normalizeAnimationSettings(s, available)).toEqual(s);
    }
  });
});

describe('maxMarginFor', () => {
  it('leaves a content box of the smallest size on the shorter side', () => {
    expect(maxMarginFor(800, 800)).toBe((800 - MIN_ANIMATION_SIZE) / 2);
    expect(maxMarginFor(801, 1000)).toBe(Math.floor((801 - MIN_ANIMATION_SIZE) / 2));
    expect(maxMarginFor(MIN_ANIMATION_SIZE, 500)).toBe(0);
    expect(maxMarginFor(10, 10)).toBe(0);
  });
});

describe('frameCountOf', () => {
  it('is the frame rate times the duration, rounded, and at least 2', () => {
    expect(frameCountOf({ fps: 20, duration: 4 })).toBe(80);
    expect(frameCountOf({ fps: 30, duration: 2.5 })).toBe(75);
    expect(frameCountOf({ fps: 24, duration: 1.3 })).toBe(31);
    expect(frameCountOf({ fps: 1, duration: 1 })).toBe(2);
    expect(frameCountOf({ fps: 0, duration: 0 })).toBe(2);
  });
});

describe('outputSizeOf', () => {
  it('keeps the size for GIF and WebP', () => {
    expect(outputSizeOf({ format: 'gif', width: 801, height: 599 })).toEqual({ width: 801, height: 599 });
    expect(outputSizeOf({ format: 'webp', width: 33, height: 35 })).toEqual({ width: 33, height: 35 });
  });

  it('rounds MP4 sizes down to even numbers of at least 2', () => {
    expect(outputSizeOf({ format: 'mp4', width: 801, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(outputSizeOf({ format: 'mp4', width: 1921, height: 1081 })).toEqual({ width: 1920, height: 1080 });
    expect(outputSizeOf({ format: 'mp4', width: 1, height: 0 })).toEqual({ width: 2, height: 2 });
  });
});
