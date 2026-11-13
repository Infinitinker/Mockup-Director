/**
 * The 3D preview: creates the stage (or a stand-in when WebGL does not work) and keeps it showing the active
 * document, with model rebuilds and scene updates coalesced to one per frame. While an animation export renders
 * from the stage, the model is locked; a batch export gets the stage to itself. Camera moves made in the viewport
 * go back into the store.
 */
import type { ModelContext } from '../../core/types/model';
import type { StageAPI } from '../../core/types/scene';
import { UserError } from '../../core/errors';
import { getModel } from '../../models/registry';
import { completeParams } from '../../models/params';
import { slotTexture } from '../../models/slots';
import { createStage } from '../../scene/stage';
import { cameraEquals, normalizeCamera } from '../../scene/camera';
import type { Store } from '../../documents/store';
import { frameCoalescer } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { notify } from '../toast';
import { log } from '../../platform/log';
import type { Preview } from '../context';

/** Viewport cameras closer than this to the store's are not stored again. */
const CAMERA_CHANGE_TOLERANCE = 1e-4;

/** Used when WebGL is unavailable – keeps the rest of the UI usable. */
function createNullStage(): StageAPI {
  return {
    setModel() {},
    applySettings() {},
    onCameraChange() {
      return () => undefined;
    },
    renderToCanvas() {
      throw new UserError(
        'Export needs the 3D preview, but WebGL does not work on this computer. Update the graphics drivers, then restart Mockup Director.',
      );
    },
    resize() {},
    dispose() {},
  };
}

/**
 * Creates the preview in `host`. When the stage cannot be created, `showError` gets the message for the user and
 * the stand-in takes its place.
 */
export function createPreview(store: Store, host: HTMLElement, showError: (message: string) => void): Preview {
  /**
   * While an animation renders, the stage must keep its model (the frames are rendered from it):
   * rebuilds requested meanwhile are deferred and run right after the export.
   */
  let modelLocked = false;
  let rebuildDeferred = false;
  /**
   * While a batch export runs it drives the stage with temporary models and scene settings; the
   * document's scene must not be pushed to the stage meanwhile (it is restored when the batch ends).
   */
  let batchActive = false;

  let stage: StageAPI;
  try {
    stage = createStage(host);
  } catch (e) {
    log.error('Cannot create the 3D view', e);
    stage = createNullStage();
    showError(
      'The 3D preview is not available: WebGL does not work on this computer. Update the graphics drivers, then restart Mockup Director.',
    );
  }

  // Model rebuild, coalesced to one per frame.
  const rebuild = frameCoalescer(() => {
    if (modelLocked) {
      rebuildDeferred = true;
      return;
    }
    const s = store.state;
    const model = getModel(s.modelId);
    const imgs = s.artwork[model.id] ?? {};
    const params = completeParams(model, s.params[model.id]);
    const ctx: ModelContext = {
      params,
      hasArtwork: (id) => !!imgs[id],
      getTexture: (id) => slotTexture(model, params, imgs, id),
    };
    try {
      stage.setModel(model.build(ctx));
    } catch (e) {
      logShownError(`Could not build model “${model.name}”`, e);
      notify.error(`Could not build model “${model.name}”`, errorMessage(e));
    }
  });
  const applyScene = frameCoalescer(() => {
    if (batchActive) return; // re-applied by endBatch()
    try {
      stage.applySettings(store.state.scene);
    } catch (e) {
      logShownError('Could not apply the scene settings', e);
      notify.error('Could not apply the scene settings', errorMessage(e));
    }
  });

  stage.onCameraChange((cam) => {
    const c = normalizeCamera(cam);
    if (cameraEquals(c, store.state.scene.camera, CAMERA_CHANGE_TOLERANCE)) return;
    store.update(
      ['camera'],
      (s) => {
        s.scene.camera = c;
      },
      { source: 'stage' },
    );
  });

  return {
    stage,
    rebuild,
    applyScene,
    get modelLocked() {
      return modelLocked;
    },
    get batchActive() {
      return batchActive;
    },
    lockModel() {
      modelLocked = true;
    },
    unlockModel() {
      modelLocked = false;
      if (rebuildDeferred) {
        rebuildDeferred = false;
        rebuild.schedule();
      }
    },
    beginBatch() {
      modelLocked = true;
      batchActive = true;
    },
    endBatch() {
      batchActive = false;
      modelLocked = false;
      rebuildDeferred = false;
      try {
        stage.applySettings(store.state.scene);
      } catch (e) {
        log.error('Cannot apply the scene settings', e);
      }
      // Rebuild the document's model right away (replaces – and disposes – the last temporary model).
      rebuild.schedule();
      rebuild.flush();
    },
    followSize() {
      // Resizing runs on every frame while the window is resized: only the first failure is logged.
      let resizeFailed = false;
      const resize = frameCoalescer(() => {
        try {
          stage.resize();
        } catch (e) {
          if (resizeFailed) return;
          resizeFailed = true;
          log.warn('Cannot resize the 3D view', e);
        }
      });
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => resize.schedule()).observe(host);
      else window.addEventListener('resize', () => resize.schedule());
    },
  };
}
