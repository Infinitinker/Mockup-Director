import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT, DEFAULT_SCENE } from '../../src/core/defaults';
import { UserError } from '../../src/core/errors';
import {
  NOT_A_PROJECT,
  PROJECT_VERSION,
  isProjectFileName,
  parseProjectFile,
  projectNameOf,
  projectWarning,
  readProjectFile,
  readProjectText,
  toProjectFile,
} from '../../src/ui/project';
import { documentState } from '../fixtures';

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
