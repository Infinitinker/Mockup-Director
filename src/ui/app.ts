/**
 * Mockup Director application shell: builds the layout, owns the store and wires the stage,
 * models, export and project handling together.
 */
import type { CameraSettings, ImageAsset, Lang, ModelContext, ParamValues, StageAPI } from '../core/types';
import { DEFAULT_EXPORT, DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { getPlaceholderTexture } from '../core/placeholder';
import { loadImageFile } from '../core/images';
import { MODELS, getModel } from '../models/registry';
import { createStage } from '../scene/stage';
import { inDesktopApp, pickFiles, saveBlob } from '../platform/files';
import { Signal, errorMessage, frameCoalescer, h, isMac, nextFrame } from './dom';
import { getLang, initLang, lt, setLang, t } from './i18n';
import { Store, countImages, disposeImageMap, hasAny, type AppState, type ImageMap } from './state';
import { VIEW_PRESETS, type Actions, type AppContext, type TabId } from './context';
import { completeParams, slotFor } from './modelUtils';
import { exportBlob, extensionFor, fileNameFor, templateBlob, webpEncodingSupported } from './exportBridge';
import { PROJECT_EXT, ProjectError, hydrateProject, loadAutosave, parseProjectFile, saveAutosave, toProjectFile } from './project';
import { mountToasts, notify } from './toast';
import { confirmDialog } from './dialog';
import { createToolbar } from './toolbar';
import { createGallery } from './gallery';
import { createViewportShell } from './viewport';
import { createInspector } from './inspector';
import { installShortcuts } from './shortcuts';

const AUTOSAVE_MS = 1500;

/** Fresh document for a model: defaults + the model's suggested camera. */
function freshDocument(modelId: string): Omit<AppState, 'lang'> {
  const model = getModel(modelId);
  const scene = cloneScene(DEFAULT_SCENE);
  scene.camera = { ...scene.camera, ...(model.defaultCamera ?? {}) };
  const exp = { ...DEFAULT_EXPORT };
  if (exp.format === 'webp' && !webpEncodingSupported()) exp.format = 'png';
  return { modelId: model.id, params: {}, images: {}, scene, export: exp };
}

/** Normalise yaw into (-180, 180] so sliders stay meaningful after orbiting around. */
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
    renderToCanvas(o) {
      const c = document.createElement('canvas');
      c.width = o.width;
      c.height = o.height;
      return c;
    },
    resize() {},
    dispose() {},
  };
}

export function startApp(root: HTMLElement): void {
  initLang();
  document.documentElement.lang = getLang();
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
  const store = new Store({ ...freshDocument(MODELS[0].id), lang: getLang() });
  const exportBusy = new Signal(false);
  const loadingSlots = new Signal<ReadonlySet<string>>(new Set());
  let projectName = '';

  /* Stage ------------------------------------------------------------ */
  const viewport = createViewportShell();
  let stage: StageAPI;
  try {
    stage = createStage(viewport.host);
  } catch (e) {
    console.error('[mockup-director] stage init failed', e);
    stage = createNullStage();
    viewport.showError(`${t('errWebgl')} (${errorMessage(e)})`);
  }

  /* Model rebuild (coalesced to one per frame) ------------------------ */
  const rebuild = frameCoalescer(() => {
    const s = store.state;
    const model = getModel(s.modelId);
    const imgs = s.images[model.id] ?? {};
    const lang = s.lang;
    const ctx: ModelContext = {
      params: completeParams(model, s.params[model.id]),
      hasImage: (id) => !!imgs[id],
      getTexture: (id) => imgs[id]?.texture ?? getPlaceholderTexture(slotFor(model, id), lang),
    };
    try {
      stage.setModel(model.build(ctx));
    } catch (e) {
      console.error('[mockup-director] model build failed', e);
      notify.error(t('errBuild', { name: lt(model.name) }), errorMessage(e));
    }
  });
  const applyScene = frameCoalescer(() => {
    try {
      stage.applySettings(store.state.scene);
    } catch (e) {
      console.error('[mockup-director] applySettings failed', e);
      notify.error(t('errScene'), errorMessage(e));
    }
  });

  /* Autosave ----------------------------------------------------------- */
  let restoring = true;
  let autosaveTimer = 0;
  let autosaveDirty = false;
  const autosaveNow = () => {
    clearTimeout(autosaveTimer);
    if (!autosaveDirty) return;
    autosaveDirty = false;
    saveAutosave(toProjectFile(store.state)).catch((e) => console.warn('[mockup-director] autosave failed', e));
  };
  const scheduleAutosave = () => {
    autosaveDirty = true;
    // While the autosave is being restored, only remember that there is unsaved work; the restore
    // flushes it when done (writing now could overwrite the snapshot we are still reading).
    if (restoring) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(autosaveNow, AUTOSAVE_MS);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosaveNow();
  });
  window.addEventListener('pagehide', autosaveNow);

  store.subscribe((e) => {
    if (hasAny(e, 'model', 'params', 'images', 'lang')) rebuild.schedule();
    // Camera changes made in the viewport are already applied there – never push them back.
    if (e.kinds.has('scene') || (e.kinds.has('camera') && e.source !== 'stage')) applyScene.schedule();
    if (e.kinds.has('lang')) document.documentElement.lang = store.state.lang;
    if (hasAny(e, 'model', 'params', 'images', 'scene', 'camera', 'export')) scheduleAutosave();
  });

  stage.onCameraChange((cam) => {
    const c = normalizeCamera(cam);
    if (cameraEquals(c, store.state.scene.camera)) return;
    store.update(['camera'], (s) => {
      s.scene.camera = c;
    }, { source: 'stage' });
  });

  /* Actions ------------------------------------------------------------ */
  let showTab: (tab: TabId) => void = () => undefined;

  const setLoading = (keys: string[], on: boolean) => {
    const next = new Set(loadingSlots.value);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    loadingSlots.set(next);
  };

  const actions: Actions = {
    selectModel(id) {
      if (id === store.state.modelId) return;
      const model = getModel(id);
      const prevId = store.state.modelId;
      // Carry artwork and matching params over to a related model the user has not touched yet
      // (e.g. "Pudełko DVD" -> "DVD z płytą"): same slot/param ids mean the same thing.
      // Assets are shared by reference; the store's GC keeps them alive while any model uses them.
      const prevImages = store.state.images[prevId] ?? {};
      const inheritImages: Record<string, ImageAsset> = {};
      if (Object.keys(store.state.images[model.id] ?? {}).length === 0) {
        for (const slot of model.slots) {
          const a = prevImages[slot.id];
          if (a) inheritImages[slot.id] = a;
        }
      }
      const prevParams = store.state.params[prevId] ?? {};
      const inheritParams: ParamValues = {};
      if (Object.keys(store.state.params[model.id] ?? {}).length === 0) {
        for (const p of model.params) if (p.id in prevParams) inheritParams[p.id] = prevParams[p.id];
      }
      const kinds: ('model' | 'camera' | 'images' | 'params')[] = ['model'];
      if (model.defaultCamera) kinds.push('camera');
      if (Object.keys(inheritImages).length) kinds.push('images');
      if (Object.keys(inheritParams).length) kinds.push('params');
      store.update(kinds, (s) => {
        s.modelId = model.id;
        if (Object.keys(inheritImages).length) s.images[model.id] = { ...inheritImages };
        if (Object.keys(inheritParams).length) s.params[model.id] = { ...inheritParams };
        if (model.defaultCamera) s.scene.camera = { ...s.scene.camera, ...model.defaultCamera };
      });
    },

    setLang(lang: Lang) {
      if (lang === store.state.lang) return;
      setLang(lang);
      store.update(['lang'], (s) => {
        s.lang = lang;
      }, { history: false });
    },

    async newProject() {
      try {
        if (countImages(store.state) > 0) {
          const ok = await confirmDialog({ title: t('newProjectTitle'), message: t('newProjectMsg'), okLabel: t('newProjectOk'), danger: true });
          if (!ok) return;
        }
        store.replace(freshDocument(store.state.modelId), 'project');
        projectName = '';
        notify.info(t('newProjectDone'));
      } catch (e) {
        notify.error(t('errUnexpected'), errorMessage(e));
      }
    },

    async openProject(file?: File) {
      try {
        let f = file;
        if (!f) {
          const files = await pickFiles(`.${PROJECT_EXT},.coverbox,application/json`, false);
          f = files[0];
        }
        if (!f) return;
        let json: unknown;
        try {
          json = JSON.parse(await f.text());
        } catch {
          throw new ProjectError(t('errNotProject'));
        }
        const parsed = parseProjectFile(json);
        document.body.classList.add('is-busy');
        const { state, failed } = await hydrateProject(parsed);
        store.replace(state, 'project');
        projectName = f.name.replace(/\.(mockup|coverbox|json)$/i, '');
        notify.success(t('projectOpened'), f.name);
        if (failed) notify.warning(t('imagesFailed', { n: failed }));
      } catch (e) {
        notify.error(t('errOpen'), errorMessage(e));
      } finally {
        document.body.classList.remove('is-busy');
      }
    },

    async saveProject() {
      try {
        const file = toProjectFile(store.state);
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
        const name = `${projectName || t('defaultProjectName')}.${PROJECT_EXT}`;
        const ok = await saveBlob(blob, name, [{ name: 'Mockup Director', extensions: [PROJECT_EXT] }]);
        if (ok) {
          notify.success(t('projectSaved'), name);
          projectName = name.replace(/\.mockup$/i, '');
        }
      } catch (e) {
        notify.error(t('errSave'), errorMessage(e));
      }
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
        if (!blob || blob.size === 0) throw new Error(t('errExportEmpty'));
        const name = fileNameFor(s.modelId, settings.format);
        const ext = extensionFor(settings.format);
        const ok = await saveBlob(blob, name, [{ name: settings.format === 'jpeg' ? 'JPEG' : settings.format.toUpperCase(), extensions: [ext] }]);
        if (ok) notify.success(t('saved'), name);
      } catch (e) {
        console.error('[mockup-director] export failed', e);
        notify.error(t('errExport'), errorMessage(e));
      } finally {
        exportBusy.set(false);
      }
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

    async assignImages(files, slotIds) {
      const model = getModel(store.state.modelId);
      if (!files.length) {
        notify.warning(t('unsupportedFile'));
        return;
      }
      if (!model.slots.length) {
        notify.warning(t('noSlots'));
        return;
      }
      let targets: string[];
      if (slotIds) {
        targets = slotIds.filter((id) => model.slots.some((s) => s.id === id)).slice(0, files.length);
      } else {
        // Empty slots first (in slot order), then overwrite filled ones from the primary slot on.
        const imgs = store.state.images[model.id] ?? {};
        const empty = model.slots.filter((s) => !imgs[s.id]).map((s) => s.id);
        const filled = model.slots.filter((s) => !!imgs[s.id]).map((s) => s.id);
        targets = [...empty, ...filled].slice(0, files.length);
      }
      if (files.length > targets.length) notify.info(t('tooManyFiles', { n: files.length - targets.length }));
      const pairs = targets.map((slotId, i) => ({ slotId, file: files[i] }));
      const keys = pairs.map((p) => `${model.id}/${p.slotId}`);
      setLoading(keys, true);
      try {
        const results = await Promise.allSettled(pairs.map((p) => loadImageFile(p.file)));
        const loaded: Record<string, ImageMap[string][string]> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') loaded[pairs[i].slotId] = r.value;
          else notify.error(t('errImage', { name: pairs[i].file.name }), errorMessage(r.reason));
        });
        if (Object.keys(loaded).length) {
          store.endBurst();
          store.update(['images'], (s) => {
            s.images[model.id] = { ...(s.images[model.id] ?? {}), ...loaded };
          });
          store.endBurst();
          if (model.id !== store.state.modelId) notify.info(t('imagesAssignedTo', { name: lt(model.name) }));
        }
      } finally {
        setLoading(keys, false);
      }
    },

    async pickImageFor(slotId) {
      try {
        const files = await pickFiles('image/*', false);
        if (files.length) await actions.assignImages(files.slice(0, 1), [slotId]);
      } catch (e) {
        notify.error(t('errPick'), errorMessage(e));
      }
    },

    removeImage(slotId) {
      const id = store.state.modelId;
      store.endBurst();
      store.update(['images'], (s) => {
        const m = { ...(s.images[id] ?? {}) };
        delete m[slotId];
        s.images[id] = m;
      });
      store.endBurst();
    },

    async downloadTemplate(slotId) {
      try {
        const s = store.state;
        const model = getModel(s.modelId);
        const slot = model.slots.find((x) => x.id === slotId);
        if (!slot) return;
        const res = await templateBlob(model.id, slot, s.lang, 300, completeParams(model, s.params[model.id]));
        if (!res) {
          notify.warning(t('noTemplate'));
          return;
        }
        const { blob, name } = res;
        const ok = await saveBlob(blob, name, [{ name: 'PNG', extensions: ['png'] }]);
        if (ok) notify.success(t('saved'), name);
      } catch (e) {
        notify.error(t('errTemplate'), errorMessage(e));
      }
    },

    showTab(tab) {
      showTab(tab);
    },
  };

  const ctx: AppContext = { store, stage, actions, exportBusy, loadingSlots };

  /* Layout -------------------------------------------------------------- */
  const toolbar = createToolbar(ctx);
  const gallery = createGallery(ctx);
  const inspector = createInspector(ctx);
  showTab = inspector.show;
  viewport.mount(ctx);
  root.replaceChildren(toolbar.el, h('div', { class: 'workspace' }, gallery.el, viewport.el, inspector.el));
  store.subscribe((e) => {
    if (e.kinds.has('lang')) toolbar.render();
  });

  installShortcuts(ctx);

  // Dropping files outside the drop zones must not navigate the web view away.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[mockup-director] unhandled rejection', e.reason);
    notify.error(t('errUnexpected'), errorMessage(e.reason));
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

  loadAutosave()
    .then(async (file) => {
      if (!file) return;
      const { state, failed } = await hydrateProject(file);
      // The user already started working while we were loading – don't overwrite that, and free the
      // decoded images (GPU textures + full-size canvases) the restore will never use.
      if (store.canUndo || countImages(store.state) > 0) {
        disposeImageMap(state.images);
        return;
      }
      store.replace(state, 'init');
      if (countImages(store.state) > 0) notify.info(t('restored'));
      if (failed) notify.warning(t('imagesFailed', { n: failed }));
    })
    .catch((e) => console.warn('[mockup-director] autosave restore skipped', e))
    .finally(() => {
      restoring = false;
      // Edits made during the restore window were only marked dirty – save them now.
      if (autosaveDirty) scheduleAutosave();
    });
}
