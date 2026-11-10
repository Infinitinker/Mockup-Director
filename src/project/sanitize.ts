/**
 * Cleaning untrusted values read from project files and the stored looks: values of the wrong type
 * and unknown keys are left out and counted, numbers are clamped into their ranges, and settings
 * this engine cannot export fall back to ones it can.
 */
import type { ExportSettings } from '../core/types/export';
import type { ParamValues } from '../core/types/model';
import type { ProjectFile } from '../core/types/project';
import type { SceneSettings } from '../core/types/scene';
import { DEFAULT_ANIMATION, DEFAULT_EXPORT, DEFAULT_SCENE, MAX_EXPORT_SIZE, cloneScene } from '../core/defaults';
import { clamp } from '../core/math';
import { MODELS } from '../models/registry';
import { sanitizeParam } from '../models/params';
import { animationFormatSupport, supportsWebpEncoding } from '../export/formats';
import { normalizeAnimationSettings } from '../export/animation/settings';

type Plain = Record<string, unknown>;

/** Whether a value is a JSON object: not null and not an array. */
export const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a stored value can take the place of the default `base`: the same type, and a finite number. */
const sameType = (base: unknown, v: unknown): boolean =>
  typeof base === typeof v && (typeof v !== 'number' || Number.isFinite(v));

/**
 * Returns a copy of `base` where every key whose value in `src` has the SAME primitive type
 * (or is a nested object) is taken from `src`. Unknown keys and wrong types are ignored, so a
 * damaged or older file can never put garbage into the state.
 */
function mergeKnown<T>(base: T, src: unknown): T {
  if (!isPlain(base) || !isPlain(src)) return base;
  const out: Plain = { ...base };
  for (const [k, bv] of Object.entries(base)) {
    const sv = src[k];
    if (sv === undefined) continue;
    if (isPlain(bv)) out[k] = mergeKnown(bv, sv);
    else if (sameType(bv, sv)) out[k] = sv;
  }
  return out as T;
}

/** How many values of `src` mergeKnown leaves out: unknown keys and values of the wrong type. */
function countUnread(base: unknown, src: unknown): number {
  if (src === undefined || !isPlain(base)) return 0;
  if (!isPlain(src)) return 1;
  // Not Object.hasOwn: Safari 15.0–15.3 lack it.
  const known = Object.keys(base);
  let n = 0;
  for (const [k, sv] of Object.entries(src)) {
    if (!known.includes(k)) n += 1;
    else if (isPlain(base[k])) n += countUnread(base[k], sv);
    else if (!sameType(base[k], sv)) n += 1;
  }
  return n;
}

/** Counts the values that are not allowed; each is replaced by its default. */
function allowedCounter(): { allowed: (ok: boolean) => boolean; count: () => number } {
  let n = 0;
  return {
    allowed: (ok) => {
      if (!ok) n += 1;
      return ok;
    },
    count: () => n,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A clean scene, and how many of the stored values were left out or replaced by their defaults. */
export function readScene(raw: unknown): { scene: SceneSettings; dropped: number } {
  const { allowed, count } = allowedCounter();
  const s = mergeKnown(cloneScene(DEFAULT_SCENE), raw);
  const c = s.camera;
  c.yaw = clamp(c.yaw, -360, 360);
  c.pitch = clamp(c.pitch, -89, 89);
  c.roll = clamp(c.roll, -180, 180);
  c.fov = clamp(c.fov, 1, 120);
  c.zoom = clamp(c.zoom, 0.05, 20);
  c.panX = clamp(c.panX, -2, 2);
  c.panY = clamp(c.panY, -2, 2);
  if (!allowed(c.projection === 'perspective' || c.projection === 'orthographic'))
    c.projection = DEFAULT_SCENE.camera.projection;
  const l = s.light;
  l.intensity = clamp(l.intensity, 0, 3);
  l.ambient = clamp(l.ambient, 0, 2);
  l.environment = clamp(l.environment, 0, 2);
  l.elevation = clamp(l.elevation, -90, 90);
  if (!allowed(HEX.test(l.color))) l.color = DEFAULT_SCENE.light.color;
  s.shadow.opacity = clamp(s.shadow.opacity, 0, 1);
  s.shadow.softness = clamp(s.shadow.softness, 0, 1);
  s.reflection.opacity = clamp(s.reflection.opacity, 0, 1);
  s.reflection.falloff = clamp(s.reflection.falloff, 0, 1);
  s.reflection.gap = clamp(s.reflection.gap, 0, 100);
  const b = s.background;
  if (!allowed(['transparent', 'color', 'gradient'].includes(b.mode))) b.mode = DEFAULT_SCENE.background.mode;
  if (!allowed(HEX.test(b.color))) b.color = DEFAULT_SCENE.background.color;
  if (!allowed(HEX.test(b.color2))) b.color2 = DEFAULT_SCENE.background.color2;
  return { scene: s, dropped: countUnread(DEFAULT_SCENE, raw) + count() };
}

/** Clamp scene values into sane ranges (after mergeKnown). */
export function sanitizeScene(raw: unknown): SceneSettings {
  return readScene(raw).scene;
}

/** Clean export settings, and how many of the stored values were left out or replaced by their defaults. */
export function readExport(raw: unknown): { settings: ExportSettings; dropped: number } {
  const { allowed, count } = allowedCounter();
  const e = mergeKnown({ ...DEFAULT_EXPORT }, raw);
  e.width = Math.round(clamp(e.width, 16, MAX_EXPORT_SIZE));
  e.height = Math.round(clamp(e.height, 16, MAX_EXPORT_SIZE));
  e.margin = Math.round(clamp(e.margin, 0, Math.floor(Math.min(e.width, e.height) / 2) - 1));
  e.quality = clamp(e.quality, 0.1, 1);
  if (!allowed(['png', 'jpeg', 'webp'].includes(e.format))) e.format = DEFAULT_EXPORT.format;
  // A project saved in a browser that can encode WebP, opened where it cannot (Safari / WKWebView).
  if (e.format === 'webp' && !supportsWebpEncoding()) e.format = 'png';
  if (!allowed(e.sizing === 'canvas' || e.sizing === 'trim')) e.sizing = DEFAULT_EXPORT.sizing;
  if (!allowed(e.background === 'transparent' || e.background === 'scene')) e.background = DEFAULT_EXPORT.background;
  // Animation settings are optional (older projects have none); mergeKnown() skips the key because
  // DEFAULT_EXPORT has no animation – validate it separately (formats this engine cannot encode fall
  // back to GIF).
  const anim = isPlain(raw) ? raw.animation : undefined;
  if (isPlain(anim)) e.animation = normalizeAnimationSettings(anim, animationFormatSupport());
  else delete e.animation;
  // Unknown keys and wrong types of the animation settings are counted too; values that
  // normalizeAnimationSettings replaces are not.
  const unread = countUnread({ ...DEFAULT_EXPORT, animation: DEFAULT_ANIMATION }, raw);
  return { settings: e, dropped: unread + count() };
}

/** The number of entries of a stored object, or 1 for any other stored value. */
const entriesIn = (v: unknown): number => (isPlain(v) ? Object.keys(v).length : 1);

/** The parameters of the known models, each checked against its definition, and how many were left out. */
export function readParams(raw: unknown): { params: Record<string, ParamValues>; dropped: number } {
  const params: Record<string, ParamValues> = {};
  if (raw === undefined) return { params, dropped: 0 };
  if (!isPlain(raw)) return { params, dropped: 1 };
  let dropped = 0;
  for (const [mid, values] of Object.entries(raw)) {
    const model = MODELS.find((m) => m.id === mid);
    if (!model || !isPlain(values)) {
      dropped += entriesIn(values);
      continue;
    }
    dropped += Object.keys(values).filter((id) => !model.params.some((p) => p.id === id)).length;
    const clean: ParamValues = {};
    for (const def of model.params) {
      const v = sanitizeParam(def, values[def.id]);
      if (v !== undefined) clean[def.id] = v;
      else if (values[def.id] !== undefined) dropped += 1;
    }
    params[mid] = clean;
  }
  return { params, dropped };
}

/** The artwork of known models and slots, and how many pieces were left out. */
export function readArtwork(raw: unknown): { artwork: ProjectFile['artwork']; dropped: number } {
  const artwork: ProjectFile['artwork'] = {};
  if (raw === undefined) return { artwork, dropped: 0 };
  if (!isPlain(raw)) return { artwork, dropped: 1 };
  let dropped = 0;
  for (const [mid, slots] of Object.entries(raw)) {
    const model = MODELS.find((m) => m.id === mid);
    if (!model || !isPlain(slots)) {
      dropped += entriesIn(slots);
      continue;
    }
    for (const [sid, art] of Object.entries(slots)) {
      const known = model.slots.some((s) => s.id === sid);
      if (!known || !isPlain(art) || typeof art.dataUrl !== 'string' || !/^data:image\//i.test(art.dataUrl)) {
        dropped += 1;
        continue;
      }
      const forModel = artwork[mid] ?? {};
      artwork[mid] = forModel;
      forModel[sid] = {
        name: typeof art.name === 'string' ? art.name.slice(0, 255) : sid,
        dataUrl: art.dataUrl,
      };
    }
  }
  return { artwork, dropped };
}
