/**
 * The items of a batch export, one per still, for each mode:
 *  - artwork  – many artwork files → one model: every file replaces ONE chosen slot of the current
 *               model; all other slots, params and the scene stay as they are;
 *  - views    – the current project from several camera views (preset views + the current view);
 *  - projects – many *.mdproj files, each with its own model, params, artwork
 *               and scene; exported with the current export settings or each project's own.
 * Every item renders from a temporary model built with the model's build(), never from the store, and
 * frees its artwork once the stage no longer shows it.
 */
import type * as THREE from 'three';
import type { ExportSettings } from '../../core/types/export';
import type { ModelContext, ParamValues } from '../../core/types/model';
import type { Artwork, ArtworkMap, DocumentState } from '../../core/types/project';
import type { SceneSettings, StageAPI } from '../../core/types/scene';
import { cloneScene } from '../../core/defaults';
import { UserError } from '../../core/errors';
import { disposeArtwork, disposeArtworks, loadImageFile } from '../../core/images';
import { getModel } from '../../models/registry';
import { completeParams } from '../../models/params';
import { slotTexture } from '../../models/slots';
import { VIEW_PRESETS } from '../../scene/views';
import { exportImage } from '../exporter';
import { supportsWebpEncoding } from '../formats';
import { slugify } from '../fileNames';
import type { BatchItem, BatchStage, RenderedItem } from './index';

/** The batch export modes; saved as `mockup-director.ui.batchMode`, so never rename them. */
export type BatchMode = 'artwork' | 'views' | 'projects';

/** What to export: the mode and what the user chose for it. */
export type BatchRequest =
  | { mode: 'artwork'; slotId: string; files: File[] }
  | {
      mode: 'views';
      /** index 0 = current view, 1.. = VIEW_PRESETS[i - 1] */
      views: boolean[];
    }
  | { mode: 'projects'; files: File[]; ownExport: boolean };

/**
 * Reads a project file for one item, with the warning about what was left out (null when nothing was).
 * The app passes readProjectToRender (src/project/format.ts), which this layer may not import.
 */
export type ProjectReader = (file: File) => Promise<{ state: DocumentState; warning: string | null }>;

/** Build a NEW object tree of a model from explicit params / artwork (never from the store). */
function buildModel(
  modelId: string,
  params: ParamValues | undefined,
  artwork: Record<string, Artwork>,
): THREE.Object3D {
  const model = getModel(modelId);
  const complete = completeParams(model, params);
  const ctx: ModelContext = {
    params: complete,
    hasArtwork: (id) => !!artwork[id],
    getTexture: (id) => slotTexture(model, complete, artwork, id),
  };
  return model.build(ctx);
}

/** Apply temporary scene settings and render one still image exactly like the normal export. */
async function renderStill(stage: StageAPI, settings: ExportSettings, scene: SceneSettings): Promise<RenderedItem> {
  stage.applySettings(scene);
  const s: ExportSettings = { ...settings };
  if (s.format === 'webp' && !supportsWebpEncoding()) s.format = 'png';
  const blob = await exportImage(stage, s, { ...scene.background });
  if (!blob || blob.size === 0)
    throw new UserError('The rendered image is empty. Export it again, or reduce the export size.');
  return { blob, format: s.format };
}

/** "My Cover (final).png" → "my-cover-final" (max 60 chars, never empty). */
function slugOf(name: string): string {
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  return slugify(stem).slice(0, 60).replace(/-+$/, '') || 'mockup';
}

/**
 * Dispose every artwork of an artwork map that never entered the store: a project read for one batch
 * item. Never call this for maps the store or its history still reference.
 */
function disposeArtworkMap(m: ArtworkMap): void {
  disposeArtworks(Object.values(m).flatMap((slots) => Object.values(slots)));
}

/**
 * The items of a batch, from the document state `s` when the batch starts (its export settings and scene
 * are copied now) and the user's `request`.
 */
export function buildBatchItems(s: DocumentState, request: BatchRequest, readProject: ProjectReader): BatchItem[] {
  const settings: ExportSettings = { ...s.export };
  const scene = cloneScene(s.scene);
  switch (request.mode) {
    case 'artwork': {
      const model = getModel(s.modelId);
      if (!model.slots.some((x) => x.id === request.slotId)) return [];
      const params = completeParams(model, s.params[model.id]);
      // The document's assets stay owned by the store (alive while the dialog blocks the UI).
      const baseArtwork: Record<string, Artwork> = { ...(s.artwork[model.id] ?? {}) };
      const slot = request.slotId;
      return request.files.map((file) => ({
        label: file.name,
        slug: slugOf(file.name),
        async render(r: BatchStage): Promise<RenderedItem> {
          const asset = await loadImageFile(file);
          let object: THREE.Object3D;
          try {
            object = buildModel(model.id, params, { ...baseArtwork, [slot]: asset });
          } catch (e) {
            disposeArtwork(asset);
            throw e;
          }
          r.showModel(object, () => disposeArtwork(asset));
          return renderStill(r.stage, settings, scene);
        },
      }));
    }
    case 'views': {
      const items: BatchItem[] = [];
      if (request.views[0]) {
        items.push({
          label: 'Current view',
          slug: slugOf('Current view'),
          render: (r) => renderStill(r.stage, settings, scene),
        });
      }
      VIEW_PRESETS.forEach((v, i) => {
        if (!request.views[i + 1]) return;
        const label = v.label;
        // Same camera change as the preset-view action (keeps fov, zoom and projection).
        const viewScene: SceneSettings = {
          ...scene,
          camera: { ...scene.camera, yaw: v.yaw, pitch: v.pitch, roll: 0, panX: 0, panY: 0 },
        };
        items.push({ label, slug: slugOf(label), render: (r) => renderStill(r.stage, settings, viewScene) });
      });
      return items;
    }
    case 'projects': {
      const ownExport = request.ownExport;
      return request.files.map((file) => ({
        label: file.name,
        slug: slugOf(file.name),
        async render(r: BatchStage): Promise<RenderedItem> {
          const { state, warning } = await readProject(file);
          let object: THREE.Object3D;
          try {
            object = buildModel(state.modelId, state.params[state.modelId], state.artwork[state.modelId] ?? {});
          } catch (e) {
            disposeArtworkMap(state.artwork);
            throw e;
          }
          r.showModel(object, () => disposeArtworkMap(state.artwork));
          const out = await renderStill(r.stage, ownExport ? state.export : settings, state.scene);
          if (warning) out.warning = warning;
          return out;
        },
      }));
    }
  }
}
