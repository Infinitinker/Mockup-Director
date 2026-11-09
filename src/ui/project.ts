/**
 * Project files (*.mdproj, JSON): serialisation, validation and hydration. The session autosave
 * (src/ui/session.ts) stores the open tabs in this format too.
 */
import type { ExportSettings, ImageAsset, ParamValues, ProjectFile, SceneSettings } from '../core/types';
import { DEFAULT_EXPORT, DEFAULT_SCENE, MAX_EXPORT_SIZE, cloneScene } from '../core/defaults';
import { loadImageDataUrl } from '../core/images';
import { MODELS, getModel } from '../models/registry';
import type { DocumentState, ImageMap } from './state';
import { sanitizeParam } from './modelUtils';
import { clamp } from './dom';
import { animationFormatSupport, webpEncodingSupported } from './exportBridge';
import { normaliseAnimationSettings } from '../export/animation/settings';

/** The extension of project files, the only one the app saves and opens. */
export const PROJECT_EXT = 'mdproj';

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
    else if (typeof bv === typeof sv && (typeof sv !== 'number' || Number.isFinite(sv))) out[k] = sv;
  }
  return out as T;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Clamp scene values into sane ranges (after mergeKnown). */
export function sanitizeScene(raw: unknown): SceneSettings {
  const s = mergeKnown(cloneScene(DEFAULT_SCENE), raw);
  const c = s.camera;
  c.yaw = clamp(c.yaw, -360, 360);
  c.pitch = clamp(c.pitch, -89, 89);
  c.roll = clamp(c.roll, -180, 180);
  c.fov = clamp(c.fov, 1, 120);
  c.zoom = clamp(c.zoom, 0.05, 20);
  c.panX = clamp(c.panX, -2, 2);
  c.panY = clamp(c.panY, -2, 2);
  if (c.projection !== 'perspective' && c.projection !== 'orthographic') c.projection = 'perspective';
  const l = s.light;
  l.intensity = clamp(l.intensity, 0, 3);
  l.ambient = clamp(l.ambient, 0, 2);
  l.environment = clamp(l.environment, 0, 2);
  l.elevation = clamp(l.elevation, -90, 90);
  if (!HEX.test(l.color)) l.color = DEFAULT_SCENE.light.color;
  s.shadow.opacity = clamp(s.shadow.opacity, 0, 1);
  s.shadow.softness = clamp(s.shadow.softness, 0, 1);
  s.reflection.opacity = clamp(s.reflection.opacity, 0, 1);
  s.reflection.falloff = clamp(s.reflection.falloff, 0, 1);
  s.reflection.gap = clamp(s.reflection.gap, 0, 100);
  const b = s.background;
  if (!['transparent', 'color', 'gradient'].includes(b.mode)) b.mode = DEFAULT_SCENE.background.mode;
  if (!HEX.test(b.color)) b.color = DEFAULT_SCENE.background.color;
  if (!HEX.test(b.color2)) b.color2 = DEFAULT_SCENE.background.color2;
  return s;
}

function sanitizeExport(raw: unknown): ExportSettings {
  const e = mergeKnown({ ...DEFAULT_EXPORT }, raw);
  e.width = Math.round(clamp(e.width, 16, MAX_EXPORT_SIZE));
  e.height = Math.round(clamp(e.height, 16, MAX_EXPORT_SIZE));
  e.margin = Math.round(clamp(e.margin, 0, Math.floor(Math.min(e.width, e.height) / 2) - 1));
  e.quality = clamp(e.quality, 0.1, 1);
  if (!['png', 'jpeg', 'webp'].includes(e.format)) e.format = 'png';
  // A project saved in a browser that can encode WebP, opened where it cannot (Safari / WKWebView).
  if (e.format === 'webp' && !webpEncodingSupported()) e.format = 'png';
  if (e.sizing !== 'canvas' && e.sizing !== 'trim') e.sizing = DEFAULT_EXPORT.sizing;
  if (e.background !== 'transparent' && e.background !== 'scene') e.background = DEFAULT_EXPORT.background;
  // Animation settings are optional (older projects have none); mergeKnown() skips the key because
  // DEFAULT_EXPORT has no animation – validate it separately (formats this engine cannot encode fall
  // back to GIF).
  const anim = isPlain(raw) ? raw.animation : undefined;
  if (isPlain(anim)) e.animation = normaliseAnimationSettings(anim, animationFormatSupport());
  else delete e.animation;
  return e;
}

/* ------------------------------------------------------------------ */
/* Serialise                                                           */
/* ------------------------------------------------------------------ */

export function toProjectFile(s: DocumentState): ProjectFile {
  const images: ProjectFile['images'] = {};
  for (const [modelId, slots] of Object.entries(s.images)) {
    const entries = Object.entries(slots).filter(([, a]) => !!a);
    if (!entries.length) continue;
    images[modelId] = {};
    for (const [slotId, a] of entries) images[modelId][slotId] = { name: a.name, dataUrl: a.dataUrl };
  }
  return {
    app: 'mockup-director',
    version: 1,
    modelId: s.modelId,
    params: JSON.parse(JSON.stringify(s.params)) as Record<string, ParamValues>,
    images,
    scene: cloneScene(s.scene),
    export: { ...s.export, ...(s.export.animation ? { animation: { ...s.export.animation } } : {}) },
  };
}

/* ------------------------------------------------------------------ */
/* Validate                                                            */
/* ------------------------------------------------------------------ */

export class ProjectError extends Error {}

/** Validate untrusted JSON and return a clean ProjectFile. Throws ProjectError with a message for the user. */
export function parseProjectFile(json: unknown): ProjectFile {
  if (!isPlain(json) || json.app !== 'mockup-director')
    throw new ProjectError('This is not a Mockup Director project file.');
  if (typeof json.version !== 'number' || json.version > 1)
    throw new ProjectError('The project file comes from a newer Mockup Director version.');

  const modelId =
    typeof json.modelId === 'string' && MODELS.some((m) => m.id === json.modelId) ? json.modelId : MODELS[0].id;

  const params: Record<string, ParamValues> = {};
  if (isPlain(json.params)) {
    for (const [mid, values] of Object.entries(json.params)) {
      const model = MODELS.find((m) => m.id === mid);
      if (!model || !isPlain(values)) continue;
      const clean: ParamValues = {};
      for (const def of model.params) {
        const v = sanitizeParam(def, values[def.id]);
        if (v !== undefined) clean[def.id] = v;
      }
      params[mid] = clean;
    }
  }

  const images: ProjectFile['images'] = {};
  if (isPlain(json.images)) {
    for (const [mid, slots] of Object.entries(json.images)) {
      const model = MODELS.find((m) => m.id === mid);
      if (!model || !isPlain(slots)) continue;
      for (const [sid, img] of Object.entries(slots)) {
        if (!model.slots.some((s) => s.id === sid) || !isPlain(img)) continue;
        if (typeof img.dataUrl !== 'string' || !/^data:image\//i.test(img.dataUrl)) continue;
        const forModel = images[mid] ?? {};
        images[mid] = forModel;
        forModel[sid] = {
          name: typeof img.name === 'string' ? img.name.slice(0, 255) : sid,
          dataUrl: img.dataUrl,
        };
      }
    }
  }

  return {
    app: 'mockup-director',
    version: 1,
    modelId,
    params,
    images,
    scene: sanitizeScene(json.scene),
    export: sanitizeExport(json.export),
  };
}

/** Decode all images of a project. Broken images are skipped and counted. */
export async function hydrateProject(file: ProjectFile): Promise<{ state: DocumentState; failed: number }> {
  const images: ImageMap = {};
  let failed = 0;
  const jobs: Promise<void>[] = [];
  for (const [mid, slots] of Object.entries(file.images)) {
    for (const [sid, img] of Object.entries(slots)) {
      jobs.push(
        loadImageDataUrl(img.dataUrl, img.name)
          .then((asset: ImageAsset) => {
            const forModel = images[mid] ?? {};
            images[mid] = forModel;
            forModel[sid] = asset;
          })
          .catch((e: unknown) => {
            failed += 1;
            console.warn('[mockup-director] image failed to load', sid, e);
          }),
      );
    }
  }
  await Promise.all(jobs);
  // Make sure the selected model exists (getModel falls back to the first one).
  const modelId = getModel(file.modelId).id;
  return {
    state: { modelId, params: file.params, images, scene: file.scene, export: file.export },
    failed,
  };
}
