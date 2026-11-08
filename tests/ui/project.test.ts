import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT, DEFAULT_SCENE } from '../../src/core/defaults';
import { MODELS } from '../../src/models/registry';
import { ProjectError, isProjectFileName, parseProjectFile, projectNameOf } from '../../src/ui/project';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('project file names', () => {
  it('recognises the project extension in any case', () => {
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

describe('parseProjectFile', () => {
  it('rejects anything that is not a project', () => {
    for (const json of [null, 'text', [], {}, { app: 'other', version: 1 }]) {
      expect(() => parseProjectFile(json)).toThrow(ProjectError);
    }
  });

  it('rejects projects from a newer or an unknown version', () => {
    expect(() => parseProjectFile({ app: 'mockup-director', version: 2 })).toThrow(ProjectError);
    expect(() => parseProjectFile({ app: 'mockup-director' })).toThrow(ProjectError);
  });

  it('fills a minimal project with defaults', () => {
    const file = parseProjectFile({ app: 'mockup-director', version: 1 });
    expect(file.modelId).toBe(MODELS[0].id);
    expect(file.params).toEqual({});
    expect(file.images).toEqual({});
    expect(file.scene).toEqual(DEFAULT_SCENE);
    expect(file.export).toEqual(DEFAULT_EXPORT);
  });

  it('replaces an unknown model and drops what belongs to unknown models, slots and params', () => {
    const file = parseProjectFile({
      app: 'mockup-director',
      version: 1,
      modelId: 'no-such-model',
      params: { box: { width: 1e9, unknown: 1, finish: 42 }, 'no-such-model': { width: 10 } },
      images: {
        box: {
          front: { name: 'front.png', dataUrl: PNG },
          nowhere: { name: 'x.png', dataUrl: PNG },
          back: { dataUrl: 'https://example.com/x.png' },
        },
        'no-such-model': { front: { name: 'front.png', dataUrl: PNG } },
      },
    });

    expect(file.modelId).toBe(MODELS[0].id);
    expect(Object.keys(file.params)).toEqual(['box']);
    const width = MODELS.find((m) => m.id === 'box')?.params.find((p) => p.id === 'width');
    if (width?.type !== 'number') throw new Error('the box model has no number parameter "width"');
    expect(file.params.box).toEqual({ width: width.max });
    expect(file.images).toEqual({ box: { front: { name: 'front.png', dataUrl: PNG } } });
  });

  it('clamps scene and export values into their ranges', () => {
    const file = parseProjectFile({
      app: 'mockup-director',
      version: 1,
      scene: { camera: { pitch: 500, fov: 'wide' }, light: { color: 'red' } },
      export: { width: 1e9, format: 'tiff' },
    });
    expect(file.scene.camera.pitch).toBe(89);
    expect(file.scene.camera.fov).toBe(DEFAULT_SCENE.camera.fov);
    expect(file.scene.light.color).toBe(DEFAULT_SCENE.light.color);
    expect(file.export.format).toBe('png');
    expect(file.export.width).toBeLessThan(1e9);
  });
});
