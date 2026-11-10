/**
 * Project files (*.mdproj, JSON): writing, reading and validating them, and decoding their artwork.
 * The session stores the open tabs in this format too.
 */
import type { ParamValues } from '../core/types/model';
import type { Artwork, ArtworkMap, DocumentState, ProjectFile } from '../core/types/project';
import { cloneScene } from '../core/defaults';
import { UserError } from '../core/errors';
import { loadImageDataUrl } from '../core/images';
import { MODELS } from '../models/registry';
import { log } from '../platform/log';
import { isPlain, readArtwork, readExport, readParams, readScene } from './sanitize';

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
            log.warn(`Artwork for the slot ${sid} failed to load`, e);
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
