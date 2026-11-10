/**
 * Project files (*.mdproj, JSON): serialization, validation and hydration. The session autosave
 * (src/ui/session.ts) stores the open tabs in this format too.
 */
import type { ExportSettings, Artwork, ParamValues, ProjectFile, SceneSettings } from '../core/types';
import { DEFAULT_ANIMATION, DEFAULT_EXPORT, DEFAULT_SCENE, MAX_EXPORT_SIZE, cloneScene } from '../core/defaults';
import { UserError } from '../core/errors';
import { loadImageDataUrl } from '../core/images';
import { MODELS } from '../models/registry';
import type { DocumentState, ArtworkMap } from './state';
import { sanitizeParam } from './modelUtils';
import { clamp } from './dom';
import { animationFormatSupport, webpEncodingSupported } from './exportBridge';
import { normalizeAnimationSettings } from '../export/animation/settings';

/** The extension of project files, the only one the app saves and opens. */
export const PROJECT_EXT = 'mdproj';

/** The file type of projects in the save dialog. */
export const PROJECT_FILE_FILTER = { name: 'Mockup Director project', extensions: [PROJECT_EXT] };

/** The project file version this app writes, and the newest one it reads. */
export const PROJECT_VERSION = 1;

export function isProjectFileName(name: string): boolean {
  return name.toLowerCase().endsWith(`.${PROJECT_EXT}`);
}

/** The file name without the project extension, e.g. "Box.mdproj" → "Box". */
export function projectNameOf(fileName: string): string {
  return isProjectFileName(fileName) ? fileName.slice(0, -PROJECT_EXT.length - 1) : fileName;
}

/* ------------------------------------------------------------------ */
/* Generic deep merge that only accepts values of the same type        */
/* ------------------------------------------------------------------ */

type Plain = Record<string, unknown>;
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
function readScene(raw: unknown): { scene: SceneSettings; dropped: number } {
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
function readExport(raw: unknown): { settings: ExportSettings; dropped: number } {
  const { allowed, count } = allowedCounter();
  const e = mergeKnown({ ...DEFAULT_EXPORT }, raw);
  e.width = Math.round(clamp(e.width, 16, MAX_EXPORT_SIZE));
  e.height = Math.round(clamp(e.height, 16, MAX_EXPORT_SIZE));
  e.margin = Math.round(clamp(e.margin, 0, Math.floor(Math.min(e.width, e.height) / 2) - 1));
  e.quality = clamp(e.quality, 0.1, 1);
  if (!allowed(['png', 'jpeg', 'webp'].includes(e.format))) e.format = DEFAULT_EXPORT.format;
  // A project saved in a browser that can encode WebP, opened where it cannot (Safari / WKWebView).
  if (e.format === 'webp' && !webpEncodingSupported()) e.format = 'png';
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

/* ------------------------------------------------------------------ */
/* Serialize                                                           */
/* ------------------------------------------------------------------ */

export function toProjectFile(s: DocumentState): ProjectFile {
  const artwork: ProjectFile['artwork'] = {};
  for (const [modelId, slots] of Object.entries(s.artwork)) {
    const entries = Object.entries(slots).filter(([, a]) => !!a);
    if (!entries.length) continue;
    artwork[modelId] = {};
    for (const [slotId, a] of entries) artwork[modelId][slotId] = { name: a.name, dataUrl: a.dataUrl };
  }
  return {
    app: 'mockup-director',
    version: PROJECT_VERSION,
    modelId: s.modelId,
    params: JSON.parse(JSON.stringify(s.params)) as Record<string, ParamValues>,
    artwork,
    scene: cloneScene(s.scene),
    export: { ...s.export, ...(s.export.animation ? { animation: { ...s.export.animation } } : {}) },
  };
}

/* ------------------------------------------------------------------ */
/* Validate                                                            */
/* ------------------------------------------------------------------ */

/** The message for a file that is not a project. */
export const NOT_A_PROJECT = `The file could not be read: it is not a Mockup Director project. Choose a .${PROJECT_EXT} file.`;

/** The message for a file that is not JSON: it cannot tell a damaged project from another file. */
const UNREADABLE = `The file could not be read: it is not a Mockup Director project, or it is damaged. Choose another .${PROJECT_EXT} file.`;

/** The message for a project whose content is unusable. */
const DAMAGED = `The project file could not be read: it is damaged. Choose another .${PROJECT_EXT} file.`;

const NEWER = 'The project comes from a newer Mockup Director. Update Mockup Director to open it.';

/** The message for an active model this build does not have (a newer version or another build has it). */
const UNKNOWN_MODEL =
  'The project uses a model that this Mockup Director does not have. Update Mockup Director to open it.';

/**
 * A project that this version cannot open but a newer one may: it comes from a newer version, or
 * its model is one this build does not have.
 */
export class NewerProjectError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = 'NewerProjectError';
  }
}

/** What parseProjectFile left out of a project because it could not read it. */
export interface ProjectReport {
  /**
   * Settings left out or replaced by their defaults: unknown ones, those of unknown models, and
   * values of the wrong type or not allowed. Numbers outside their range are clamped, not counted.
   */
  settings: number;
  /** Artwork left out: of an unknown model or slot, or not a data:image URL. */
  artwork: number;
}

/** A project as it was read: the clean file and what was left out of it. */
export interface ParsedProject {
  file: ProjectFile;
  report: ProjectReport;
}

/** The number of entries of a stored object, or 1 for any other stored value. */
const entriesIn = (v: unknown): number => (isPlain(v) ? Object.keys(v).length : 1);

/** The parameters of the known models, each checked against its definition, and how many were left out. */
function readParams(raw: unknown): { params: Record<string, ParamValues>; dropped: number } {
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
function readArtwork(raw: unknown): { artwork: ProjectFile['artwork']; dropped: number } {
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

/**
 * Validate untrusted JSON and return a clean ProjectFile, with a report of what was left out.
 * Throws a UserError when the project cannot be opened: a NewerProjectError when a newer version may open it.
 */
export function parseProjectFile(json: unknown): ParsedProject {
  if (!isPlain(json) || json.app !== 'mockup-director') throw new UserError(NOT_A_PROJECT);
  const { version, modelId } = json;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new UserError(DAMAGED);
  if (version > PROJECT_VERSION) throw new NewerProjectError(NEWER);
  if (typeof modelId !== 'string') throw new UserError(DAMAGED);
  if (!MODELS.some((m) => m.id === modelId)) throw new NewerProjectError(UNKNOWN_MODEL);

  const { params, dropped: droppedParams } = readParams(json.params);
  const { artwork, dropped: droppedArtwork } = readArtwork(json.artwork);
  const { scene, dropped: droppedScene } = readScene(json.scene);
  const { settings, dropped: droppedExport } = readExport(json.export);
  return {
    file: { app: 'mockup-director', version: PROJECT_VERSION, modelId, params, artwork, scene, export: settings },
    report: { settings: droppedParams + droppedScene + droppedExport, artwork: droppedArtwork },
  };
}

/** Reads the text of a project file. Throws a UserError when the project cannot be opened. */
export function readProjectText(text: string): ParsedProject {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new UserError(UNREADABLE, { cause: e });
  }
  return parseProjectFile(json);
}

/** The message for a file that could not be read at all; the interface names the file next to it. */
const NOT_READABLE =
  'The file could not be read: it may have been moved, deleted or locked. Check that it still exists and can be opened, then try again.';

/**
 * Reads a chosen or dropped project file. Throws a UserError when the file cannot be read (it was
 * moved, deleted or locked after it was chosen) or the project cannot be opened.
 */
export async function readProjectFile(file: Blob): Promise<ParsedProject> {
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    throw new UserError(NOT_READABLE, { cause: e });
  }
  return readProjectText(text);
}

/**
 * The warning shown when opened projects lost some of their parts, or null when they lost none.
 * `failed` is the artwork that hydrateProject could not decode. For a project `file`, which stays as
 * it is, a newer version may still read what was left out; the restored `session` tabs are written
 * again without it by the next autosave.
 */
export function projectWarning(report: ProjectReport, failed: number, from: 'file' | 'session'): string | null {
  const artwork = report.artwork + failed;
  if (!report.settings && !artwork) return null;
  const texts = [
    from === 'file'
      ? 'Parts of the project could not be read and were left out.'
      : 'Parts of the projects that were open could not be read and were left out.',
  ];
  if (report.settings) texts.push(`Settings: ${report.settings}.`);
  if (artwork) texts.push(`Artwork: ${artwork}.`);
  if (!report.settings && !report.artwork) texts.push('Add the artwork again.');
  else if (from === 'file')
    texts.push(
      'The project may come from a newer Mockup Director: update Mockup Director, or set what is missing again.',
    );
  else texts.push('Set what is missing again.');
  return texts.join(' ');
}

/** Decode all artwork of a project. Artwork that cannot be decoded is skipped and counted. */
export async function hydrateProject(file: ProjectFile): Promise<{ state: DocumentState; failed: number }> {
  const artwork: ArtworkMap = {};
  let failed = 0;
  const jobs: Promise<void>[] = [];
  for (const [mid, slots] of Object.entries(file.artwork)) {
    for (const [sid, art] of Object.entries(slots)) {
      jobs.push(
        loadImageDataUrl(art.dataUrl, art.name)
          .then((asset: Artwork) => {
            const forModel = artwork[mid] ?? {};
            artwork[mid] = forModel;
            forModel[sid] = asset;
          })
          .catch((e: unknown) => {
            failed += 1;
            console.warn('[mockup-director] artwork failed to load', sid, e);
          }),
      );
    }
  }
  await Promise.all(jobs);
  return {
    state: { modelId: file.modelId, params: file.params, artwork, scene: file.scene, export: file.export },
    failed,
  };
}
