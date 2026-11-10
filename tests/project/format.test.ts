/**
 * Tests the project files in src/project/format.ts: file names, writing a project and reading it back,
 * what parsing leaves out, clamps and counts (the cleaning in src/project/sanitize.ts, through
 * parseProjectFile), the size limit of the text written, reading text and files, decoding the artwork one at a
 * time, reading a project to render it once, and the warning about what was left out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT, DEFAULT_SCENE, defaultParams } from '../../src/core/defaults';
import { UserError } from '../../src/core/errors';
import { loadImageDataUrl } from '../../src/core/images';
import type { ProjectFile } from '../../src/core/types/project';
import { inheritedParams } from '../../src/models/params';
import { getModel } from '../../src/models/registry';
import {
  MAX_PROJECT_SIZE,
  NOT_A_PROJECT,
  PROJECT_VERSION,
  hydrateProject,
  isProjectFileName,
  parseProjectFile,
  projectFileText,
  projectNameOf,
  projectWarning,
  readProjectFile,
  readProjectText,
  readProjectToRender,
  toProjectFile,
} from '../../src/project/format';
import { documentState, fakeImage } from '../fixtures';

// The real decoder, which fails in Node, unless a test gives it another implementation.
vi.mock('../../src/core/images', async (importOriginal) => {
  const images = await importOriginal<typeof import('../../src/core/images')>();
  return { ...images, loadImageDataUrl: vi.fn(images.loadImageDataUrl) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadImageDataUrl).mockReset();
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** The smallest project this version reads, with `fields` over it. */
const project = (fields: Record<string, unknown> = {}) => ({
  app: 'mockup-director',
  version: PROJECT_VERSION,
  modelId: 'box',
  ...fields,
});

/** The error that `read` throws; fails when it throws none or not a UserError. */
function errorOf(read: () => unknown): UserError {
  try {
    read();
  } catch (e) {
    if (e instanceof UserError) return e;
    throw e;
  }
  throw new Error('nothing was thrown');
}

describe('project file names', () => {
  it('recognizes the project extension in any case', () => {
    expect(isProjectFileName('Box.mdproj')).toBe(true);
    expect(isProjectFileName('BOX.MDPROJ')).toBe(true);
    expect(isProjectFileName('Box.json')).toBe(false);
    expect(isProjectFileName('mdproj')).toBe(false);
  });

  it('takes the extension off project names only', () => {
    expect(projectNameOf('Box.mdproj')).toBe('Box');
    expect(projectNameOf('My.box.MDPROJ')).toBe('My.box');
    expect(projectNameOf('Box.json')).toBe('Box.json');
  });
});

describe('toProjectFile', () => {
  it('writes the current version, which the reader opens unchanged and with nothing left out', () => {
    const state = documentState('box');
    state.params = { box: { width: 120 } };
    const file = toProjectFile(state);
    expect(file.version).toBe(PROJECT_VERSION);
    const { file: read, report } = parseProjectFile(JSON.parse(JSON.stringify(file)));
    expect(read).toEqual(file);
    expect(report).toEqual({ settings: 0, artwork: 0 });
  });

  it('writes the params carried over from another model so that they read back with nothing left out', () => {
    const laptop = getModel('device-laptop');
    const monitor = getModel('device-monitor');
    const prev = defaultParams(laptop);
    const state = documentState(monitor.id);
    state.params = { [laptop.id]: prev, [monitor.id]: inheritedParams(monitor, prev) };
    const { report } = parseProjectFile(JSON.parse(JSON.stringify(toProjectFile(state))));
    expect(report).toEqual({ settings: 0, artwork: 0 });
  });
});

describe('projectFileText', () => {
  /** A project file of the box with `count` pieces of artwork, each named "a.png" with the data URL `dataUrl`. */
  function withArtwork(count: number, dataUrl: string): ProjectFile {
    const file = toProjectFile(documentState('box'));
    file.artwork = { box: {} };
    for (let i = 0; i < count; i++) file.artwork.box[`slot${i}`] = { name: 'a.png', dataUrl };
    return file;
  }

  it('is the project as JSON, which reads back unchanged', () => {
    const file = toProjectFile(documentState('box'));
    file.artwork = { box: { front: { name: 'front.png', dataUrl: PNG }, back: { name: 'back.png', dataUrl: PNG } } };
    const text = projectFileText(file);
    expect(text).toBe(JSON.stringify(file));
    expect(readProjectText(text).file.artwork).toEqual(file.artwork);
  });

  it('refuses a project whose artwork is over the limit before joining the text, with its size and the limit', () => {
    // Nine slots share one string of 50 MB less the name: 450 MB of artwork, but only 50 MB of memory.
    const file = withArtwork(9, 'A'.repeat(50_000_000 - 'a.png'.length));
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(() => projectFileText(file)).toThrow(
      new UserError(
        'The project is too large to save: 450 MB, more than the 400 MB a project can hold. Remove artwork or replace it with smaller files, then save again.',
      ),
    );
    expect(stringify).not.toHaveBeenCalled();
  });

  it('refuses a text over the limit', () => {
    const file = withArtwork(1, PNG);
    vi.spyOn(JSON, 'stringify').mockReturnValue({ length: MAX_PROJECT_SIZE + 1 } as unknown as string);
    expect(() => projectFileText(file)).toThrow(
      /^The project is too large to save: 401 MB, more than the 400 MB a project can hold\./,
    );
  });

  it('turns the engine’s string limit into a UserError that says what to do', () => {
    const file = withArtwork(1, PNG);
    const failure = new RangeError('Invalid string length');
    vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw failure;
    });
    let error: unknown;
    try {
      projectFileText(file);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toBe(
      'The project is too large to save. Remove artwork or replace it with smaller files, then save again.',
    );
    expect((error as UserError).cause).toBe(failure);
  });

  it('lets other errors through', () => {
    const file = withArtwork(1, PNG);
    const failure = new TypeError('Do not know how to serialize a BigInt');
    vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw failure;
    });
    expect(() => projectFileText(file)).toThrow(failure);
  });
});

describe('parseProjectFile', () => {
  it('refuses anything that is not a project as not a project', () => {
    for (const json of [null, 'text', 42, [], {}, { app: 'other', version: 1, modelId: 'box' }]) {
      expect(errorOf(() => parseProjectFile(json)).message).toBe(NOT_A_PROJECT);
    }
  });

  it('refuses a project from a newer version and says to update', () => {
    const message = errorOf(() => parseProjectFile(project({ version: PROJECT_VERSION + 1 }))).message;
    expect(message).toMatch(/newer Mockup Director/);
    expect(message).toMatch(/Update Mockup Director/);
  });

  it('refuses a version that is not a whole number from 1 as damaged', () => {
    for (const version of [0, -1, 1.5, '1', null, undefined]) {
      const message = errorOf(() => parseProjectFile(project({ version }))).message;
      expect(message).toMatch(/it is damaged/);
      expect(message).not.toBe(NOT_A_PROJECT);
    }
  });

  it('refuses a project without an active model as damaged', () => {
    for (const modelId of [undefined, null, 3, { id: 'box' }]) {
      expect(errorOf(() => parseProjectFile(project({ modelId }))).message).toMatch(/it is damaged/);
    }
  });

  it('refuses an unknown active model and says to update', () => {
    const message = errorOf(() => parseProjectFile(project({ modelId: 'no-such-model' }))).message;
    expect(message).toMatch(/model that this Mockup Director does not have/);
    expect(message).toMatch(/Update Mockup Director/);
  });

  it('fills a minimal project with defaults and reports nothing', () => {
    const { file, report } = parseProjectFile(project());
    expect(file.modelId).toBe('box');
    expect(file.params).toEqual({});
    expect(file.artwork).toEqual({});
    expect(file.scene).toEqual(DEFAULT_SCENE);
    expect(file.export).toEqual(DEFAULT_EXPORT);
    expect(report).toEqual({ settings: 0, artwork: 0 });
  });

  it('drops what belongs to unknown models, slots and params, and counts it', () => {
    const { file, report } = parseProjectFile(
      project({
        // Unknown: 1; replaced by its default: finish; clamped, not counted: width.
        params: { box: { width: 1e9, unknown: 1, finish: 42 }, 'no-such-model': { width: 10, depth: 5 } },
        artwork: {
          box: {
            front: { name: 'front.png', dataUrl: PNG },
            nowhere: { name: 'x.png', dataUrl: PNG },
            back: { dataUrl: 'https://example.com/x.png' },
            left: 'front.png',
          },
          'no-such-model': { front: { name: 'front.png', dataUrl: PNG } },
        },
      }),
    );

    expect(Object.keys(file.params)).toEqual(['box']);
    const width = file.params.box.width;
    expect(width).toBeLessThan(1e9);
    expect(file.params.box).toEqual({ width });
    expect(file.artwork).toEqual({ box: { front: { name: 'front.png', dataUrl: PNG } } });
    expect(report).toEqual({ settings: 4, artwork: 4 });
  });

  it('counts params and artwork that are not objects', () => {
    expect(parseProjectFile(project({ params: 'none', artwork: [] })).report).toEqual({ settings: 1, artwork: 1 });
    expect(parseProjectFile(project({ params: { box: 5 }, artwork: { box: null } })).report).toEqual({
      settings: 1,
      artwork: 1,
    });
  });

  it('clamps scene and export values into their ranges without counting them', () => {
    const { file, report } = parseProjectFile(
      project({ scene: { camera: { pitch: 500 } }, export: { width: 1e9, quality: 7 } }),
    );
    expect(file.scene.camera.pitch).toBe(89);
    expect(file.export.width).toBeLessThan(1e9);
    expect(file.export.quality).toBe(1);
    expect(report).toEqual({ settings: 0, artwork: 0 });
  });

  it('counts scene and export values that are unknown, of the wrong type or not allowed', () => {
    const { file, report } = parseProjectFile(
      project({
        scene: {
          camera: { fov: 'wide', projection: 'fisheye', tilt: 3 },
          light: { color: 'red' },
          shadow: 'soft',
          background: { mode: 'image' },
        },
        export: { format: 'tiff', sizing: 'fit', dpi: 300, animation: { fps: 'fast', loops: 2 } },
      }),
    );
    expect(file.scene.camera.fov).toBe(DEFAULT_SCENE.camera.fov);
    expect(file.scene.camera.projection).toBe(DEFAULT_SCENE.camera.projection);
    expect(file.scene.light.color).toBe(DEFAULT_SCENE.light.color);
    expect(file.scene.shadow).toEqual(DEFAULT_SCENE.shadow);
    expect(file.scene.background.mode).toBe(DEFAULT_SCENE.background.mode);
    expect(file.export.format).toBe(DEFAULT_EXPORT.format);
    expect(file.export.sizing).toBe(DEFAULT_EXPORT.sizing);
    // Scene: fov, projection, tilt, color, shadow, mode. Export: format, sizing, dpi, fps, loops.
    expect(report).toEqual({ settings: 11, artwork: 0 });
  });
});

describe('readProjectText', () => {
  it('reads a project', () => {
    const { file, report } = readProjectText(JSON.stringify(project()));
    expect(file.modelId).toBe('box');
    expect(report).toEqual({ settings: 0, artwork: 0 });
  });

  it('refuses text that is not JSON as not a project or damaged', () => {
    for (const text of ['', 'not json', '{"app":"mockup-director",', '\u0089PNG']) {
      const error = errorOf(() => readProjectText(text));
      expect(error.message).toMatch(/not a Mockup Director project, or it is damaged/);
      expect(error.cause).toBeInstanceOf(SyntaxError);
    }
  });

  it('keeps the messages of the JSON reader', () => {
    expect(errorOf(() => readProjectText('{"app":"other"}')).message).toBe(NOT_A_PROJECT);
    expect(errorOf(() => readProjectText('{"app":"mockup-director","version":0}')).message).toMatch(/damaged/);
  });
});

describe('readProjectFile', () => {
  it('reads the project in a file', async () => {
    const { file } = await readProjectFile(new Blob([JSON.stringify(project())]));
    expect(file.modelId).toBe('box');
  });

  it('refuses a file that cannot be read any more with a UserError that says what to do', async () => {
    const failure = new DOMException('The file could not be read', 'NotReadableError');
    const gone = { text: () => Promise.reject(failure) } as unknown as Blob;
    const error = await readProjectFile(gone).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/could not be read: .*then try again\.$/);
    expect((error as UserError).cause).toBe(failure);
  });
});

describe('projectWarning', () => {
  it('says nothing when nothing was left out', () => {
    expect(projectWarning({ settings: 0, artwork: 0 }, 0, 'file')).toBeNull();
  });

  it('counts settings and artwork in one warning and says to update', () => {
    const warning = projectWarning({ settings: 3, artwork: 1 }, 1, 'file');
    expect(warning).toBe(
      'Parts of the project could not be read and were left out. Settings: 3. Artwork: 2. The project may come from a newer Mockup Director: update Mockup Director, or set what is missing again.',
    );
  });

  it('leaves out a count of zero', () => {
    const warning = projectWarning({ settings: 2, artwork: 0 }, 0, 'file');
    expect(warning).toMatch(/Settings: 2\./);
    expect(warning).not.toMatch(/Artwork/);
  });

  it('only says to add the artwork again when all that failed was decoding it', () => {
    expect(projectWarning({ settings: 0, artwork: 0 }, 2, 'file')).toBe(
      'Parts of the project could not be read and were left out. Artwork: 2. Add the artwork again.',
    );
  });

  it('says only to set it again for the restored session, whose next autosave drops what was left out', () => {
    expect(projectWarning({ settings: 1, artwork: 2 }, 3, 'session')).toBe(
      'Parts of the projects that were open could not be read and were left out. Settings: 1. Artwork: 5. Set what is missing again.',
    );
    expect(projectWarning({ settings: 0, artwork: 0 }, 1, 'session')).toBe(
      'Parts of the projects that were open could not be read and were left out. Artwork: 1. Add the artwork again.',
    );
  });
});

describe('hydrateProject', () => {
  it('decodes one artwork at a time, keeps what decodes and counts what does not', async () => {
    let decoding = 0;
    let most = 0;
    vi.mocked(loadImageDataUrl).mockImplementation(async (_dataUrl, name) => {
      decoding += 1;
      most = Math.max(most, decoding);
      await new Promise((resolve) => setTimeout(resolve, 1));
      decoding -= 1;
      if (name === 'bad.png') throw new UserError('damaged');
      return fakeImage(name).asset;
    });
    const file = toProjectFile(documentState('box'));
    file.artwork = {
      box: { front: { name: 'front.png', dataUrl: PNG }, back: { name: 'bad.png', dataUrl: PNG } },
      'book-paperback': { front: { name: 'cover.png', dataUrl: PNG } },
      disc: { label: { name: 'bad.png', dataUrl: PNG } },
    };
    const { state, failed } = await hydrateProject(file);
    expect(most).toBe(1);
    expect(failed).toBe(2);
    expect(Object.keys(state.artwork)).toEqual(['box', 'book-paperback']);
    expect(state.artwork.box.front?.name).toBe('front.png');
    expect(state.artwork.box.back).toBeUndefined();
    expect(state.artwork['book-paperback'].front?.name).toBe('cover.png');
  });
});

describe('readProjectToRender', () => {
  /** A project file of the box with `fields`; Node decodes no image, so every artwork it decodes fails. */
  const projectFile = (fields: Record<string, unknown> = {}) => new File([JSON.stringify(project(fields))], 'a.mdproj');

  it('decodes only the shown model’s artwork', async () => {
    const other = { 'book-paperback': { front: { name: 'front.png', dataUrl: PNG } } };
    const { state, warning } = await readProjectToRender(projectFile({ artwork: other }));
    expect(state.modelId).toBe('box');
    expect(state.artwork).toEqual({});
    expect(warning).toBeNull();

    const own = { box: { front: { name: 'front.png', dataUrl: PNG } } };
    expect((await readProjectToRender(projectFile({ artwork: own }))).warning).toBe(
      'Parts of the project could not be read and were left out. Artwork: 1. Add the artwork again.',
    );
  });

  it('warns about what parsing left out', async () => {
    const { warning } = await readProjectToRender(projectFile({ params: { box: { unknown: 1 } } }));
    expect(warning).toBe(projectWarning({ settings: 1, artwork: 0 }, 0, 'file'));
  });

  it('refuses what readProjectFile refuses', async () => {
    const error = await readProjectToRender(new File(['not json'], 'a.mdproj')).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/not a Mockup Director project, or it is damaged/);
  });
});
