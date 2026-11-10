/**
 * Mockup Director application shell: builds the layout, owns the store and wires the stage,
 * models, export and project handling together. Every open project is a tab (./documents); the
 * store works on the active one, and the whole set of tabs is autosaved as a session (./session).
 */
import type { CameraSettings, Artwork, ModelContext, ParamValues, StageAPI } from '../core/types';
import { DEFAULT_ANIMATION, DEFAULT_EXPORT, DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { UserError } from '../core/errors';
import { getPlaceholderTexture } from '../core/placeholder';
import { disposeArtwork, loadImageFile } from '../core/images';
import { MODELS, getModel } from '../models/registry';
import { createStage } from '../scene/stage';
import { inDesktopApp, pickFiles, saveBlob } from '../platform/files';
import { handleOpenedFiles } from '../platform/launch';
import { onWindowClose, setWindowTitle } from '../platform/window';
import { Signal, errorMessage, frameCoalescer, h, isMac, logShownError, nextFrame } from './dom';

import { Store, hasAny, type DocumentState, type ArtworkMap } from './state';
import { Documents } from './documents';
import { indexedDbSessionStore, loadSession, SessionSaver } from './session';
import { SESSION_DAMAGED, type UnopenedTab } from './sessionRecords';
import { openRecoveryDialog } from './recovery';
import { createTabBar, tabLabel } from './tabbar';
import { VIEW_PRESETS, type Actions, type AppContext, type TabId } from './context';
import { completeParams, inheritedParams, slotFor } from './modelUtils';
import {
  animationFileFilter,
  animationFileName,
  exportAnimationBlob,
  exportBlob,
  extensionFor,
  fileNameFor,
  IMAGE_FORMAT_LABEL,
  isAnimationCanceled,
  templateBlob,
  webpEncodingSupported,
  type AnimationProgress,
} from './exportBridge';
import {
  PROJECT_EXT,
  PROJECT_FILE_FILTER,
  hydrateProject,
  projectNameOf,
  projectWarning,
  readProjectFile,
  toProjectFile,
} from './project';
import { mountToasts, notify } from './toast';
import { choiceDialog } from './dialog';
import { openBatchDialog, type BatchHost } from './batch';
import { createToolbar } from './toolbar';
import { createGallery } from './gallery';
import { createViewportShell } from './viewport';
import { createInspector } from './inspector';
import { installShortcuts } from './shortcuts';
import { log } from '../platform/log';

const AUTOSAVE_MS = 1500;

/** Fresh document for a model: defaults + the model's suggested camera. */
function freshDocument(modelId: string): DocumentState {
  const model = getModel(modelId);
  const scene = cloneScene(DEFAULT_SCENE);
  scene.camera = { ...scene.camera, ...(model.defaultCamera ?? {}) };
  const exp = { ...DEFAULT_EXPORT };
  if (exp.format === 'webp' && !webpEncodingSupported()) exp.format = 'png';
  return { modelId: model.id, params: {}, artwork: {}, scene, export: exp };
}

/** Normalize yaw into (-180, 180] so sliders stay meaningful after orbiting around. */
function normalizeCamera(c: CameraSettings): CameraSettings {
  let yaw = ((((c.yaw + 180) % 360) + 360) % 360) - 180;
  if (yaw === -180) yaw = 180;
  return { ...c, yaw };
}

function cameraEquals(a: CameraSettings, b: CameraSettings): boolean {
  const eps = 1e-4;
  return (
    a.projection === b.projection &&
    Math.abs(a.yaw - b.yaw) < eps &&
    Math.abs(a.pitch - b.pitch) < eps &&
    Math.abs(a.roll - b.roll) < eps &&
    Math.abs(a.fov - b.fov) < eps &&
    Math.abs(a.zoom - b.zoom) < eps &&
    Math.abs(a.panX - b.panX) < eps &&
    Math.abs(a.panY - b.panY) < eps
  );
}

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

export function startApp(root: HTMLElement): void {
  root.classList.add('app');
  try {
    // Only macOS draws traffic lights over the toolbar (titleBarStyle "Overlay"); Windows keeps its
    // native title bar, so no extra left inset there.
    root.classList.toggle('has-traffic-lights', isMac && inDesktopApp());
  } catch {
    /* not in Tauri */
  }
  mountToasts(document.body);

  /* State ------------------------------------------------------------ */
  const store = new Store(freshDocument(MODELS[0].id));
  /** The open projects (tabs); the store holds the active one. */
  const docs = new Documents(store, () => freshDocument(store.state.modelId));
  const exportBusy = new Signal(false);
  const animationProgress = new Signal<AnimationProgress | null>(null);
  /** Aborts the running animation export. */
  let animationAbort: AbortController | null = null;
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
  const loadingSlots = new Signal<ReadonlySet<string>>(new Set());

  /* Stage ------------------------------------------------------------ */
  const viewport = createViewportShell();
  let stage: StageAPI;
  try {
    stage = createStage(viewport.host);
  } catch (e) {
    log.error('Cannot create the 3D view', e);
    stage = createNullStage();
    viewport.showError(
      'The 3D preview is not available: WebGL does not work on this computer. Update the graphics drivers, then restart Mockup Director.',
    );
  }

  /* Model rebuild (coalesced to one per frame) ------------------------ */
  const rebuild = frameCoalescer(() => {
    if (modelLocked) {
      rebuildDeferred = true;
      return;
    }
    const s = store.state;
    const model = getModel(s.modelId);
    const imgs = s.artwork[model.id] ?? {};
    const ctx: ModelContext = {
      params: completeParams(model, s.params[model.id]),
      hasArtwork: (id) => !!imgs[id],
      getTexture: (id) => imgs[id]?.texture ?? getPlaceholderTexture(slotFor(model, id)),
    };
    try {
      stage.setModel(model.build(ctx));
    } catch (e) {
      logShownError(`Could not build model “${model.name}”`, e);
      notify.error(`Could not build model “${model.name}”`, errorMessage(e));
    }
  });
  const applyScene = frameCoalescer(() => {
    if (batchActive) return; // re-applied by batchHost.end()
    try {
      stage.applySettings(store.state.scene);
    } catch (e) {
      logShownError('Could not apply the scene settings', e);
      notify.error('Could not apply the scene settings', errorMessage(e));
    }
  });

  /* Session autosave: every open tab, restored on the next start ---------- */
  const session = new SessionSaver(indexedDbSessionStore);
  let restoring = true;
  /**
   * False until the last session is restored, and for the whole run when it could not be: autosave
   * then stays off, so the stored tabs are kept for the next start instead of being overwritten. A
   * damaged index is no such failure: its tabs are restored from their records, and the next save
   * writes a new index.
   */
  let sessionReadable = false;
  let autosaveTimer = 0;
  let autosaveDirty = false;
  let autosaveFailureShown = false;
  /** The message of the failure last logged while autosave keeps failing; null while it works. */
  let autosaveFailure: string | null = null;
  /** The save in progress (or the last one); the close flush waits for it. Never rejects. */
  let saving: Promise<void> = Promise.resolve();
  const autosaveNow = (): Promise<void> => {
    clearTimeout(autosaveTimer);
    if (!autosaveDirty || restoring || !sessionReadable) return saving;
    autosaveDirty = false;
    saving = session.save(docs.snapshot(), docs.activeId).then(
      () => {
        if (autosaveFailure === null) return;
        autosaveFailure = null;
        log.info('Autosave works again');
      },
      (e: unknown) => {
        // A lasting failure is logged once, not at every pause in editing; a different one again.
        const message = errorMessage(e);
        if (message !== autosaveFailure) logShownError('Autosave failed', e);
        autosaveFailure = message;
        // Once per run: the work is still open, but would not come back after a restart.
        if (!autosaveFailureShown) {
          autosaveFailureShown = true;
          notify.error(
            'Your open projects could not be saved for the next start. They are still open: save them to files to keep them.',
            message,
          );
        }
      },
    );
    return saving;
  };
  const scheduleAutosave = () => {
    autosaveDirty = true;
    // While the session is being restored, only remember that there is unsaved work; the restore
    // flushes it when done (writing now could overwrite the records we are still reading).
    if (restoring) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => void autosaveNow(), AUTOSAVE_MS);
  };
  // Tabs opened, closed, renamed or switched change the session too.
  docs.subscribe(scheduleAutosave);
  onWindowClose(autosaveNow);

  store.subscribe((e) => {
    // A new / opened / restored document disposes the old document's artwork textures, which the
    // (locked) model of a running animation export still renders – stop the export before its next
    // frame instead of encoding frames with blank artwork.
    if (modelLocked && (e.source === 'project' || e.source === 'document')) animationAbort?.abort();
    if (hasAny(e, 'model', 'params', 'artwork')) rebuild.schedule();
    // Camera changes made in the viewport are already applied there – never push them back.
    if (e.kinds.has('scene') || (e.kinds.has('camera') && e.source !== 'stage')) applyScene.schedule();
    if (hasAny(e, 'model', 'params', 'artwork', 'scene', 'camera', 'export')) scheduleAutosave();
  });

  stage.onCameraChange((cam) => {
    const c = normalizeCamera(cam);
    if (cameraEquals(c, store.state.scene.camera)) return;
    store.update(
      ['camera'],
      (s) => {
        s.scene.camera = c;
      },
      { source: 'stage' },
    );
  });

  /* Actions ------------------------------------------------------------ */
  let showTab: (tab: TabId) => void = () => undefined;

  const setLoading = (keys: string[], on: boolean) => {
    const next = new Set(loadingSlots.value);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    loadingSlots.set(next);
  };

  /** Project files that arrived while an export ran; they open when it ends. */
  let waitingFiles: File[] = [];
  exportBusy.subscribe((busy) => {
    if (busy || !waitingFiles.length) return;
    const files = waitingFiles;
    waitingFiles = [];
    void openProjectFiles(files);
  });

  /**
   * Opens project files, each in its own tab; the first may take the place of an untouched new tab.
   * A file that cannot be opened is reported and skipped; one whose parts were left out opens with a
   * warning.
   */
  const openProjectFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return;
    if (exportBusy.value) {
      waitingFiles.push(...files);
      notify.info(`Projects to open: ${files.length}. They open when the export ends.`);
      return;
    }
    document.body.classList.add('is-busy');
    try {
      for (const f of files) {
        try {
          const { file, report } = await readProjectFile(f);
          const { state, failed } = await hydrateProject(file);
          const name = projectNameOf(f.name);
          // An export may have started while the file was read: the stage must keep its project.
          if (exportBusy.value) {
            docs.add(state, { name, activate: false });
          } else if (docs.activeIsPristine()) {
            store.replace(state, 'project');
            docs.markActiveOpened(name);
          } else {
            docs.add(state, { name });
          }
          notify.success('Project opened', f.name);
          const warning = projectWarning(report, failed, 'file');
          if (warning) notify.warning(warning, f.name);
        } catch (e) {
          logShownError(`Could not open the project ${f.name}`, e);
          notify.error('Could not open the project', `${f.name}: ${errorMessage(e)}`);
        }
      }
    } finally {
      document.body.classList.remove('is-busy');
    }
  };

  const actions: Actions = {
    selectModel(id) {
      if (id === store.state.modelId) return;
      const model = getModel(id);
      const prevId = store.state.modelId;
      // Carry artwork and matching params over to a related model the user has not touched yet
      // (e.g. "DVD case" -> "DVD case with disc"): same slot/param ids mean the same thing.
      // Assets are shared by reference; the store's GC keeps them alive while any model uses them.
      const prevArtwork = store.state.artwork[prevId] ?? {};
      const inheritedArtwork: Record<string, Artwork> = {};
      if (Object.keys(store.state.artwork[model.id] ?? {}).length === 0) {
        for (const slot of model.slots) {
          const a = prevArtwork[slot.id];
          if (a) inheritedArtwork[slot.id] = a;
        }
      }
      const prevParams = store.state.params[prevId] ?? {};
      const inheritParams: ParamValues =
        Object.keys(store.state.params[model.id] ?? {}).length === 0 ? inheritedParams(model, prevParams) : {};
      const kinds: ('model' | 'camera' | 'artwork' | 'params')[] = ['model'];
      if (model.defaultCamera) kinds.push('camera');
      if (Object.keys(inheritedArtwork).length) kinds.push('artwork');
      if (Object.keys(inheritParams).length) kinds.push('params');
      store.update(kinds, (s) => {
        s.modelId = model.id;
        if (Object.keys(inheritedArtwork).length) s.artwork[model.id] = { ...inheritedArtwork };
        if (Object.keys(inheritParams).length) s.params[model.id] = { ...inheritParams };
        if (model.defaultCamera) s.scene.camera = { ...s.scene.camera, ...model.defaultCamera };
      });
    },

    async newProject() {
      if (exportBusy.value) return;
      docs.add(freshDocument(store.state.modelId));
    },

    async openProject(file?: File) {
      try {
        const files = file ? [file] : await pickFiles(`.${PROJECT_EXT}`, true);
        await openProjectFiles(files);
      } catch (e) {
        logShownError('Could not open the project', e);
        notify.error('Could not open the project', errorMessage(e));
      }
    },

    async saveProject(tabId = docs.activeId) {
      try {
        // Everything is taken from the tab now: other tabs may become active while the save dialog
        // is open (a project opened from the system), and edits may continue while it writes.
        if (!docs.tab(tabId)) return false;
        docs.activate(tabId);
        const revision = store.revision;
        const file = toProjectFile(store.state);
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
        const suggested = `${docs.tab(tabId)?.name || 'project'}.${PROJECT_EXT}`;
        const saved = await saveBlob(blob, suggested, [PROJECT_FILE_FILTER]);
        if (!saved) return false;
        docs.markSaved(tabId, revision, projectNameOf(saved));
        notify.success('Project saved', saved);
        return true;
      } catch (e) {
        logShownError('Could not save the project', e);
        notify.error('Could not save the project', errorMessage(e));
        return false;
      }
    },

    async closeProject(tabId = docs.activeId) {
      if (exportBusy.value) return;
      const tab = docs.tab(tabId);
      if (!tab) return;
      if (tab.dirty) {
        // Show the project the question is about.
        docs.activate(tabId);
        const choice = await choiceDialog({
          title: `Save changes to “${tabLabel(tab)}”?`,
          message: 'Your changes will be lost if you don’t save them.',
          choices: [
            { id: 'save', label: 'Save…', primary: true },
            { id: 'discard', label: 'Don’t save', danger: true },
            { id: 'cancel', label: 'Cancel' },
          ],
        });
        // The tab may have been closed meanwhile; save exactly this tab, whatever is active now.
        if (!docs.tab(tabId)) return;
        if (choice === 'save') {
          if (!(await actions.saveProject(tabId))) return;
        } else if (choice !== 'discard') {
          return;
        }
      }
      docs.close(tabId);
    },

    switchProject(step) {
      if (exportBusy.value) return;
      docs.cycle(step);
    },

    async exportImage() {
      if (exportBusy.value) return;
      exportBusy.set(true);
      try {
        // Make sure the stage shows the latest model/scene, then let the busy state paint.
        rebuild.flush();
        applyScene.flush();
        await nextFrame();
        await nextFrame();
        const s = store.state;
        const settings = { ...s.export };
        if (settings.format === 'webp' && !webpEncodingSupported()) settings.format = 'png';
        const blob = await exportBlob(stage, settings, { ...s.scene.background });
        if (!blob || blob.size === 0)
          throw new UserError('The rendered image is empty. Export it again, or reduce the export size.');
        const name = fileNameFor(s.modelId, settings.format);
        const ext = extensionFor(settings.format);
        const saved = await saveBlob(blob, name, [{ name: IMAGE_FORMAT_LABEL[settings.format], extensions: [ext] }]);
        if (saved) notify.success('Saved', saved);
      } catch (e) {
        logShownError('Export failed', e);
        notify.error('Export failed', errorMessage(e));
      } finally {
        exportBusy.set(false);
      }
    },

    async exportAnimation() {
      if (exportBusy.value) return;
      exportBusy.set(true);
      const abort = new AbortController();
      animationAbort = abort;
      animationProgress.set({ phase: 'prepare', done: 0, total: 0 });
      try {
        rebuild.flush();
        applyScene.flush();
        await nextFrame();
        await nextFrame();
        const s = store.state;
        const modelId = s.modelId;
        const settings = { ...(s.export.animation ?? DEFAULT_ANIMATION) };
        modelLocked = true;
        let result: Awaited<ReturnType<typeof exportAnimationBlob>>;
        try {
          result = await exportAnimationBlob(
            stage,
            settings,
            { ...s.scene.background },
            (p) => animationProgress.set(p),
            abort.signal,
          );
        } finally {
          modelLocked = false;
          if (rebuildDeferred) {
            rebuildDeferred = false;
            rebuild.schedule();
          }
        }
        animationProgress.set(null);
        const name = animationFileName(modelId, result.format);
        const saved = await saveBlob(result.blob, name, [animationFileFilter(result.format)]);
        if (saved) notify.success('Saved', saved);
      } catch (e) {
        if (isAnimationCanceled(e)) {
          notify.info('Animation export canceled');
        } else {
          logShownError('Animation export failed', e);
          notify.error('Animation export failed', errorMessage(e));
        }
      } finally {
        animationAbort = null;
        animationProgress.set(null);
        exportBusy.set(false);
      }
    },

    cancelAnimation() {
      animationAbort?.abort();
    },

    openBatchExport() {
      if (exportBusy.value) {
        notify.warning('Another export is running. Wait for it to finish.');
        return;
      }
      openBatchDialog(ctx, batchHost);
    },

    undo() {
      store.undo();
    },
    redo() {
      store.redo();
    },

    setView(index) {
      const v = VIEW_PRESETS[index];
      if (!v) return;
      store.endBurst();
      store.update(['camera'], (s) => {
        s.scene.camera = { ...s.scene.camera, yaw: v.yaw, pitch: v.pitch, roll: 0, panX: 0, panY: 0 };
      });
      store.endBurst();
    },

    resetView() {
      const model = getModel(store.state.modelId);
      store.endBurst();
      store.update(['camera'], (s) => {
        s.scene.camera = { ...DEFAULT_SCENE.camera, ...(model.defaultCamera ?? {}) };
      });
      store.endBurst();
    },

    async assignArtwork(files, slotIds) {
      const model = getModel(store.state.modelId);
      if (!files.length) {
        notify.warning('This file type is not supported. Choose an image file, such as PNG, JPEG or WebP.');
        return;
      }
      if (!model.slots.length) {
        notify.warning('This model has no artwork slots. Choose a model that takes artwork.');
        return;
      }
      let targets: string[];
      if (slotIds) {
        targets = slotIds.filter((id) => model.slots.some((s) => s.id === id)).slice(0, files.length);
      } else {
        // Empty slots first (in slot order), then overwrite filled ones from the primary slot on.
        const imgs = store.state.artwork[model.id] ?? {};
        const empty = model.slots.filter((s) => !imgs[s.id]).map((s) => s.id);
        const filled = model.slots.filter((s) => !!imgs[s.id]).map((s) => s.id);
        targets = [...empty, ...filled].slice(0, files.length);
      }
      if (files.length > targets.length)
        notify.info(`Skipped files: ${files.length - targets.length}. The model has no more slots for them.`);
      const pairs = targets.map((slotId, i) => ({ slotId, file: files[i] }));
      // Decoding takes a while: the artwork belongs to this tab, even if another one is shown by then.
      const tabId = docs.activeId;
      const keys = pairs.map((p) => `${model.id}/${p.slotId}`);
      setLoading(keys, true);
      try {
        const results = await Promise.allSettled(pairs.map((p) => loadImageFile(p.file)));
        const loaded: Record<string, ArtworkMap[string][string]> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') loaded[pairs[i].slotId] = r.value;
          else {
            logShownError(`Could not load “${pairs[i].file.name}”`, r.reason);
            notify.error(`Could not load “${pairs[i].file.name}”`, errorMessage(r.reason));
          }
        });
        if (Object.keys(loaded).length && !docs.tab(tabId)) {
          // The tab was closed meanwhile.
          Object.values(loaded).forEach(disposeArtwork);
        } else if (Object.keys(loaded).length) {
          docs.activate(tabId);
          store.endBurst();
          store.update(['artwork'], (s) => {
            s.artwork[model.id] = { ...(s.artwork[model.id] ?? {}), ...loaded };
          });
          store.endBurst();
          if (model.id !== store.state.modelId) notify.info(`Artwork assigned to “${model.name}”`);
        }
      } finally {
        setLoading(keys, false);
      }
    },

    async pickArtworkFor(slotId) {
      try {
        const files = await pickFiles('image/*', false);
        if (files.length) await actions.assignArtwork(files.slice(0, 1), [slotId]);
      } catch (e) {
        logShownError('Could not pick the file', e);
        notify.error('Could not pick the file', errorMessage(e));
      }
    },

    removeArtwork(slotId) {
      const id = store.state.modelId;
      store.endBurst();
      store.update(['artwork'], (s) => {
        const m = { ...(s.artwork[id] ?? {}) };
        delete m[slotId];
        s.artwork[id] = m;
      });
      store.endBurst();
    },

    async downloadTemplate(slotId) {
      try {
        const s = store.state;
        const model = getModel(s.modelId);
        const slot = model.slots.find((x) => x.id === slotId);
        if (!slot) return;
        const res = await templateBlob(model.id, slot, 300, completeParams(model, s.params[model.id]));
        if (!res) {
          notify.warning('This slot has no print template.');
          return;
        }
        const { blob, name } = res;
        const saved = await saveBlob(blob, name, [{ name: 'PNG', extensions: ['png'] }]);
        if (saved) notify.success('Saved', saved);
      } catch (e) {
        logShownError('Could not create the print template', e);
        notify.error('Could not create the print template', errorMessage(e));
      }
    },

    showTab(tab) {
      showTab(tab);
    },
  };

  const ctx: AppContext = { store, stage, actions, exportBusy, animationProgress, loadingSlots };

  /**
   * Exclusive stage access for the batch export (src/ui/batch.ts). The batch never touches the store:
   * it renders temporary models / scene settings, and end() puts the document back on the stage –
   * the exact scene settings and camera from the store plus a normal rebuild of the document's model.
   */
  const batchHost: BatchHost = {
    begin() {
      if (exportBusy.value || batchActive) return false;
      // Make sure the stage shows the latest document before it is frozen.
      rebuild.flush();
      applyScene.flush();
      exportBusy.set(true);
      modelLocked = true;
      batchActive = true;
      return true;
    },
    end() {
      if (!batchActive) return;
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
      exportBusy.set(false);
    },
  };

  /* Layout -------------------------------------------------------------- */
  const toolbar = createToolbar(ctx);
  const gallery = createGallery(ctx);
  const inspector = createInspector(ctx);
  const tabBar = createTabBar(docs, {
    onNew: () => void actions.newProject(),
    onClose: (id) => void actions.closeProject(id),
    onActivate: (id) => {
      if (!exportBusy.value) docs.activate(id);
    },
    busy: exportBusy,
  });
  showTab = inspector.show;
  viewport.mount(ctx);
  root.replaceChildren(
    toolbar.el,
    h(
      'div',
      { class: 'workspace' },
      gallery.el,
      h('div', { class: 'workspace-center' }, tabBar.el, viewport.el),
      inspector.el,
    ),
  );

  /** The window title names the active project, with a • when it has unsaved changes. */
  const updateTitle = () => {
    const tab = docs.tab(docs.activeId);
    setWindowTitle(tab ? `${tabLabel(tab)}${tab.dirty ? ' •' : ''} – Mockup Director` : 'Mockup Director');
  };
  docs.subscribe(updateTitle);
  updateTitle();

  installShortcuts(ctx);

  // Dropping files outside the drop zones must not navigate the web view away.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  window.addEventListener('unhandledrejection', (e) => {
    notify.error('An action could not be finished', errorMessage(e.reason));
  });

  // Keep the renderer sized to its container.
  const resize = frameCoalescer(() => {
    try {
      stage.resize();
    } catch {
      /* ignore */
    }
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => resize.schedule()).observe(viewport.host);
  else window.addEventListener('resize', () => resize.schedule());

  /* First frame + restore autosave --------------------------------------- */
  applyScene.schedule();
  applyScene.flush();
  rebuild.schedule();
  rebuild.flush();

  /** The stored copies the restore could not open: the recovery dialog offers them once it is done. */
  let unopened: UnopenedTab[] = [];
  restoreSession()
    .catch((e) => {
      logShownError('Session restore failed', e);
      notify.error(
        'The projects that were open last time could not be reopened, and open projects are not saved automatically. Save them to files to keep them.',
        errorMessage(e),
      );
    })
    .finally(() => {
      restoring = false;
      // The restore marked the session for a save (to repair the index), or edits made meanwhile
      // were only marked dirty: save them now.
      if (autosaveDirty) void autosaveNow();
      if (unopened.length) void openRecoveryDialog(unopened, forgetUnopened);
      unopened = [];
      // Projects the operating system asked to open (a double-clicked .mdproj), each in a tab.
      void handleOpenedFiles(
        (files) => void openProjectFiles(files),
        (e) => {
          logShownError('Could not open the project', e);
          notify.error('Could not open the project', errorMessage(e));
        },
      );
    });

  /**
   * Removes a copy the user saved to a file or deleted in the recovery dialog from the session, with
   * the open tabs as they are now. Rejects when it stays stored.
   */
  function forgetUnopened(id: string): Promise<void> {
    const done = session.forget(id, docs.snapshot(), docs.activeId);
    // The close flush waits for it, like for an autosave.
    saving = done.catch(() => undefined);
    return done;
  }

  /** Reopens the tabs of the last session (their unsaved changes included). */
  async function restoreSession(): Promise<void> {
    const loaded = await loadSession();
    if (!loaded) {
      // Nothing was stored: autosave may write from now on.
      sessionReadable = true;
      return;
    }
    const { session: stored, recovered, missing, indexDamaged, repair } = loaded;
    const restored: { id: string; name: string; dirty: boolean; state: DocumentState }[] = [];
    let failedArtwork = 0;
    const leftOut = { settings: 0, artwork: 0 };
    for (const tab of stored.tabs) {
      const { state, failed } = await hydrateProject(tab.file);
      failedArtwork += failed;
      leftOut.settings += tab.report.settings;
      leftOut.artwork += tab.report.artwork;
      restored.push({ id: tab.id, name: tab.name, dirty: tab.dirty, state });
    }
    // The user may already have started working in the first tab while we were loading: keep it.
    const initial = docs.activeId;
    const replaceInitial = docs.activeIsPristine() && restored.length > 0;
    for (const r of restored)
      docs.add(r.state, { id: r.id, name: r.name, dirty: r.dirty, activate: false, position: 'end' });
    // The unopened entries stay in the index, and their records are deleted only when the user chooses to.
    session.adopt(
      restored.map((r) => r.id),
      loaded.unopened,
    );
    unopened = loaded.unopened;
    // Nothing else may change: mark the session for the save that runs right after the restore, so the
    // index is rewritten without the dropped entries and with every record it should list.
    if (repair) autosaveDirty = true;
    // Restored without an error: autosave may write from now on.
    sessionReadable = true;
    if (replaceInitial) {
      docs.activate(restored.some((r) => r.id === stored.activeId) ? stored.activeId : restored[0].id);
      docs.close(initial);
    }
    if (indexDamaged && restored.length) notify.warning(SESSION_DAMAGED);
    else if (recovered)
      notify.warning(`Projects reopened from their stored copies: ${recovered}. Check them and save them to files.`);
    if (restored.length) notify.info(`Restored the projects that were open: ${restored.length}`);
    if (missing) notify.warning(`Projects that could not be reopened: ${missing}. Open them again from their files.`);
    const warning = projectWarning(leftOut, failedArtwork, 'session');
    if (warning) notify.warning(warning);
  }
}
