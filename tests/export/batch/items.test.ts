/**
 * Tests the items of a batch export in src/export/batch/items.ts: which items each mode makes, their labels
 * and file-name stems, the scene and settings each item renders with, and when a project's artwork is freed.
 * Node renders nothing, so every render stops at the fake stage's renderToCanvas.
 */
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportSettings } from '../../../src/core/types/export';
import type { Artwork, DocumentState } from '../../../src/core/types/project';
import type { BatchStage } from '../../../src/export/batch';
import { buildBatchItems, type ProjectReader } from '../../../src/export/batch/items';
import { getModel } from '../../../src/models/registry';
import { VIEW_PRESETS } from '../../../src/scene/views';
import { documentState } from '../../fixtures';
import { artworkTexture, stubCanvasDocument } from '../../models/fakeContext';
import { fakeStage, RENDER_STOPPED } from './fakeStage';

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (name: string) => new File([], name);
const noReader: ProjectReader = () => Promise.reject(new Error('No project is read in this test.'));
const allViews = () => [true, ...VIEW_PRESETS.map(() => true)];

/** A document whose camera is turned, zoomed and panned, so a preset view visibly changes it. */
function turnedDocument(): DocumentState {
  const s = documentState('box');
  s.scene.camera = { ...s.scene.camera, yaw: 77, pitch: 7, roll: 5, fov: 31, zoom: 2, panX: 0.5, panY: -0.5 };
  return s;
}

/** A batch stage on a fake stage that keeps the dispose callbacks instead of running them. */
function batchStage() {
  const fake = fakeStage();
  const disposers: (() => void)[] = [];
  const r: BatchStage = {
    stage: fake.stage,
    showModel(object: THREE.Object3D, dispose: () => void) {
      fake.stage.setModel(object);
      disposers.push(dispose);
    },
  };
  return { ...fake, r, disposers };
}

/** Artwork with a texture whose dispose is a spy, for every slot of the model (or the given ones). */
function artworkFor(modelId: string, slotIds = getModel(modelId).slots.map((s) => s.id)) {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  const artwork: Record<string, Artwork> = {};
  for (const id of slotIds) {
    const texture = artworkTexture(1000, 1000);
    spies.push(vi.spyOn(texture, 'dispose'));
    artwork[id] = { name: `${id}.png`, dataUrl: 'data:image/png;base64,', width: 1000, height: 1000, texture };
  }
  return { artwork, spies };
}

describe('the file-name stems', () => {
  const stemsOf = (...names: string[]) =>
    buildBatchItems(documentState('box'), { mode: 'artwork', slotId: 'front', files: names.map(file) }, noReader).map(
      (i) => i.slug,
    );

  it('slugify the name without one extension of up to five characters', () => {
    expect(stemsOf('My Cover (final).png', 'cover.jpeg', 'notes.backup1', 'archive.tar.gz')).toEqual([
      'my-cover-final',
      'cover',
      'notes-backup1',
      'archive-tar',
    ]);
  });

  it('are at most 60 characters, never end in a dash and are never empty', () => {
    const [long, dashed, empty, symbols] = stemsOf(
      `${'a'.repeat(70)}.png`,
      `${'b'.repeat(59)} c.png`,
      '.png',
      '!!!.png',
    );
    expect(long).toBe('a'.repeat(60));
    expect(dashed).toBe('b'.repeat(59));
    expect(empty).toBe('mockup');
    expect(symbols).toBe('mockup');
  });
});

describe('buildBatchItems', () => {
  it('makes one item per artwork file, labeled with its name', () => {
    const items = buildBatchItems(
      documentState('box'),
      { mode: 'artwork', slotId: 'front', files: [file('a.png'), file('b.webp')] },
      noReader,
    );
    expect(items.map((i) => i.label)).toEqual(['a.png', 'b.webp']);
  });

  it('makes no artwork items for a slot the model does not have', () => {
    const request = { mode: 'artwork' as const, slotId: 'no-such-slot', files: [file('a.png')] };
    expect(buildBatchItems(documentState('box'), request, noReader)).toEqual([]);
  });

  it('makes one item per chosen view, the current view first', () => {
    const items = buildBatchItems(documentState('box'), { mode: 'views', views: allViews() }, noReader);
    expect(items.map((i) => i.label)).toEqual(['Current view', ...VIEW_PRESETS.map((v) => v.label)]);
    expect(items.map((i) => i.slug)).toEqual(['current-view', 'front', '3-4-left', '3-4-right', 'side', 'top', 'back']);

    const some = VIEW_PRESETS.map((_, i) => i === 1);
    const chosen = buildBatchItems(documentState('box'), { mode: 'views', views: [false, ...some] }, noReader);
    expect(chosen.map((i) => i.label)).toEqual([VIEW_PRESETS[1].label]);
  });

  it('renders the current view with the document camera and each preset like the view action', async () => {
    const s = turnedDocument();
    const before = structuredClone(s.scene);
    const items = buildBatchItems(s, { mode: 'views', views: allViews() }, noReader);
    for (const [i, item] of items.entries()) {
      const { r, scenes } = batchStage();
      await expect(item.render(r)).rejects.toBe(RENDER_STOPPED);
      const camera = scenes[0].camera;
      if (i === 0) expect(camera).toEqual(before.camera);
      else {
        const v = VIEW_PRESETS[i - 1];
        expect(camera).toEqual({ ...before.camera, yaw: v.yaw, pitch: v.pitch, roll: 0, panX: 0, panY: 0 });
      }
      expect({ ...scenes[0], camera: before.camera }).toEqual(before);
    }
    expect(s.scene).toEqual(before);
  });

  it('copies the settings and the scene when it is called', async () => {
    const s = turnedDocument();
    const [current] = buildBatchItems(s, { mode: 'views', views: [true] }, noReader);
    const expected = structuredClone(s.scene);
    s.scene.camera.yaw = 0;
    s.export.width = 16;
    const { r, scenes, renders } = batchStage();
    await expect(current.render(r)).rejects.toBe(RENDER_STOPPED);
    expect(scenes[0]).toEqual(expected);

    const [after] = buildBatchItems(s, { mode: 'views', views: [true] }, noReader);
    const later = batchStage();
    await expect(after.render(later.r)).rejects.toBe(RENDER_STOPPED);
    expect(later.renders[0]).not.toEqual(renders[0]);
  });

  it('exports WebP as PNG where the engine cannot encode WebP, instead of failing', async () => {
    const s = documentState('box');
    s.export = { ...s.export, format: 'webp' };
    const [current] = buildBatchItems(s, { mode: 'views', views: [true] }, noReader);
    const { r, renders } = batchStage();
    await expect(current.render(r)).rejects.toBe(RENDER_STOPPED);
    expect(renders).toHaveLength(1);
  });
});

describe('the Many projects items', () => {
  /** A box project with artwork in every slot, exported at 800 × 600 px. */
  function boxProject(): { state: DocumentState; spies: ReturnType<typeof vi.spyOn>[] } {
    const state = documentState('box');
    const { artwork, spies } = artworkFor('box');
    state.artwork = { box: artwork };
    state.export = { ...state.export, width: 800, height: 600 };
    return { state, spies };
  }

  /** What the views mode asks the stage to render for a document with these export settings. */
  async function renderRequestFor(exportSettings: ExportSettings) {
    const s = documentState('box');
    s.export = exportSettings;
    const [current] = buildBatchItems(s, { mode: 'views', views: [true] }, noReader);
    const { r, renders } = batchStage();
    await expect(current.render(r)).rejects.toBe(RENDER_STOPPED);
    return renders[0];
  }

  it('reads each project file and renders it with the batch settings or its own', async () => {
    stubCanvasDocument();
    const project = boxProject();
    const reader = vi.fn<ProjectReader>(async () => ({ state: project.state, warning: null }));
    const doc = documentState('box');
    const projectFile = file('a.mdproj');

    for (const ownExport of [false, true]) {
      const [only] = buildBatchItems(doc, { mode: 'projects', files: [projectFile], ownExport }, reader);
      expect(only.label).toBe('a.mdproj');
      // The project extension has six characters, one more than the stem drops.
      expect(only.slug).toBe('a-mdproj');
      const { r, models, renders, scenes } = batchStage();
      await expect(only.render(r)).rejects.toBe(RENDER_STOPPED);
      expect(reader).toHaveBeenLastCalledWith(projectFile);
      expect(models).toHaveLength(1);
      expect(scenes[0]).toBe(project.state.scene);
      expect(renders[0]).toEqual(await renderRequestFor(ownExport ? project.state.export : doc.export));
    }
    expect(await renderRequestFor(project.state.export)).not.toEqual(await renderRequestFor(doc.export));
  });

  it('frees the project artwork once the stage no longer shows it', async () => {
    stubCanvasDocument();
    const project = boxProject();
    const reader: ProjectReader = async () => ({ state: project.state, warning: null });
    const [only] = buildBatchItems(
      documentState('box'),
      { mode: 'projects', files: [file('a.mdproj')], ownExport: false },
      reader,
    );
    const { r, disposers } = batchStage();
    await expect(only.render(r)).rejects.toBe(RENDER_STOPPED);
    for (const spy of project.spies) expect(spy).not.toHaveBeenCalled();
    for (const dispose of disposers) dispose();
    for (const spy of project.spies) expect(spy).toHaveBeenCalledOnce();
  });

  it('frees the project artwork at once when its model cannot be built', async () => {
    stubCanvasDocument();
    const state = documentState('box');
    // One slot without artwork needs a placeholder, which cannot be drawn without a 2D context.
    const slots = getModel('box').slots.map((s) => s.id);
    const { artwork, spies } = artworkFor('box', slots.slice(1));
    state.artwork = { box: artwork };
    const reader: ProjectReader = async () => ({ state, warning: null });
    const [only] = buildBatchItems(
      documentState('box'),
      { mode: 'projects', files: [file('a.mdproj')], ownExport: false },
      reader,
    );
    const { r, models } = batchStage();
    await expect(only.render(r)).rejects.not.toBe(RENDER_STOPPED);
    expect(models).toEqual([]);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});
