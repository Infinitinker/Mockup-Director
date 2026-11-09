/**
 * Animation settings: limits, normalization (used for persisted projects and defensively by the
 * exporter) and small derived values (frame count, effective size).
 */
import type { AnimationFormat, AnimationSettings } from '../../core/types';
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
} from '../../core/defaults';

const FORMATS: readonly AnimationFormat[] = ['gif', 'webp', 'mp4'];

/** Largest side for a format. */
export function maxSizeFor(format: AnimationFormat): number {
  return format === 'mp4' ? MAX_VIDEO_SIZE : MAX_ANIMATION_SIZE;
}

/** Highest fps for a format. */
export function maxFpsFor(format: AnimationFormat): number {
  return format === 'mp4' ? MAX_VIDEO_FPS : MAX_ANIMATION_FPS;
}

/** Suggested fps when switching to a format. */
export function defaultFpsFor(format: AnimationFormat): number {
  return format === 'mp4' ? DEFAULT_VIDEO_FPS : DEFAULT_GIF_FPS;
}

/** Number of frames of one loop (at least 2). The last frame is NOT a copy of the first. */
export function frameCountOf(s: Pick<AnimationSettings, 'fps' | 'duration'>): number {
  return Math.max(2, Math.round(s.fps * s.duration));
}

/** The pixel size actually encoded (MP4 / H.264 needs even dimensions). */
export function outputSizeOf(s: Pick<AnimationSettings, 'format' | 'width' | 'height'>): {
  width: number;
  height: number;
} {
  if (s.format !== 'mp4') return { width: s.width, height: s.height };
  return { width: Math.max(2, s.width & ~1), height: Math.max(2, s.height & ~1) };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Return a complete, clamped copy of (possibly untrusted / partial) animation settings.
 * `available` limits the format (e.g. no WebP in Safari, no MP4 without WebCodecs) – falls back to GIF.
 */
export function normalizeAnimationSettings(
  raw: unknown,
  available: Partial<Record<AnimationFormat, boolean>> = {},
): AnimationSettings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof AnimationSettings, unknown>>;
  const d = DEFAULT_ANIMATION;
  let format = pick(src.format, FORMATS, d.format);
  if (available[format] === false) format = 'gif';
  const maxSide = maxSizeFor(format);
  let width = Math.round(num(src.width, d.width));
  let height = Math.round(num(src.height, d.height));
  // Keep the aspect ratio when a side is too large.
  const k = Math.min(1, maxSide / Math.max(width, height, 1));
  width = Math.round(clamp(width * k, MIN_ANIMATION_SIZE, maxSide));
  height = Math.round(clamp(height * k, MIN_ANIMATION_SIZE, maxSide));
  return {
    format,
    width,
    height,
    margin: Math.round(clamp(num(src.margin, d.margin), 0, maxMarginFor(width, height))),
    fps: Math.round(clamp(num(src.fps, defaultFpsFor(format)), 1, maxFpsFor(format))),
    duration: clamp(
      Math.round(num(src.duration, d.duration) * 10) / 10,
      MIN_ANIMATION_DURATION,
      MAX_ANIMATION_DURATION,
    ),
    motion: pick(src.motion, ['loop', 'swing'] as const, d.motion),
    swingAngle: Math.round(clamp(num(src.swingAngle, d.swingAngle), 1, 180)),
    direction: pick(src.direction, ['cw', 'ccw'] as const, d.direction),
    easing: pick(src.easing, ['sine', 'linear'] as const, d.easing),
    background: pick(src.background, ['transparent', 'scene'] as const, d.background),
    dither: pick(src.dither, ['floyd', 'ordered', 'none'] as const, d.dither),
    palette: pick(src.palette, ['global', 'frame'] as const, d.palette),
    quality: pick(src.quality, ['low', 'medium', 'high'] as const, d.quality),
    useViewZoomPan: typeof src.useViewZoomPan === 'boolean' ? src.useViewZoomPan : d.useViewZoomPan,
  };
}

/** Largest margin that still leaves a MIN_ANIMATION_SIZE content box. */
export function maxMarginFor(width: number, height: number): number {
  return Math.max(0, Math.floor((Math.min(width, height) - MIN_ANIMATION_SIZE) / 2));
}
