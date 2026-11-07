/**
 * Mockup Director application shell: builds the layout, owns the store and wires the stage,
 * models, export and project handling together. Every open project is a tab (./documents); the
 * store works on the active one, and the whole set of tabs is autosaved as a session (./session).
 */
import type { CameraSettings, ImageAsset, Lang, ModelContext, ParamValues, StageAPI } from '../core/types';
import { DEFAULT_ANIMATION, DEFAULT_EXPORT, DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { getPlaceholderTexture } from '../core/placeholder';
import { disposeImageAsset, loadImageFile } from '../core/images';
import { MODELS, getModel } from '../models/registry';
import { createStage } from '../scene/stage';
import { inDesktopApp, pickFiles, saveBlob } from '../platform/files';
import { handleOpenedFiles } from '../platform/launch';
import { onWindowClose, setWindowTitle } from '../platform/window';
import { Signal, errorMessage, frameCoalescer, h, isMac, nextFrame, safeStorage } from './dom';

/** localStorage key of the interface language the user picked. */
const LANG_KEY = 'mockup-director.lang';
import { getLang, initLang, lt, setLang, t } from '../i18n';
import { Store, hasAny, type DocumentState, type ImageMap } from './state';
import { Documents } from './documents';
import { loadSession, SessionSaver } from './session';
import { createTabBar, tabLabel } from './tabbar';
import { VIEW_PRESETS, type Actions, type AppContext, type TabId } from './context';
import { completeParams, slotFor } from './modelUtils';
import {
  animationFileFilter,
  animationFileName,
  exportAnimationBlob,
  exportBlob,
  extensionFor,
  fileNameFor,
  isAnimationCancelled,
  templateBlob,
  webpEncodingSupported,
  type AnimationProgress,
} from './exportBridge';
import { PROJECT_EXT, ProjectError, hydrateProject, parseProjectFile, projectNameOf, toProjectFile } from './project';
import { mountToasts, notify } from './toast';
import { choiceDialog } from './dialog';
import { openBatchDialog, type BatchHost } from './batch';
import { createToolbar } from './toolbar';
import { createGallery } from './gallery';
import { createViewportShell } from './viewport';
import { createInspector } from './inspector';
import { installShortcuts } from './shortcuts';

const AUTOSAVE_MS = 1500;

/** Fresh document for a model: defaults + the model's suggested camera. */
function freshDocument(modelId: string): DocumentState {
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
  initLang(safeStorage.get(LANG_KEY), navigator.languages ?? [navigator.language]);
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
    console.error('[mockup-director] stage init failed', e);
    stage = createNullStage();
    viewport.showError(`${t('errWebgl')} (${errorMessage(e)})`);
  }

  /* Model rebuild (coalesced to one per frame) ------------------------ */
  const rebuild = frameCoalescer(() => {
    if (modelLocked) {
      rebuildDeferred = true;
      return;
    }
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
    if (batchActive) return; // re-applied by batchHost.end()
    try {
      stage.applySettings(store.state.scene);
    } catch (e) {
      console.error('[mockup-director] applySettings failed', e);
      notify.error(t('errScene'), errorMessage(e));
    }
  });

  /* Session autosave: every open tab, restored on the next start ---------- */
  const session = new SessionSaver();
  let restoring = true;
  /**
   * False when the last session could not be read: autosave then stays off for this run, so the
   * stored tabs are kept for the next start instead of being overwritten.
   */
  let sessionReadable = false;
  let autosaveTimer = 0;
  let autosaveDirty = false;
  let autosaveFailureShown = false;
  /** The save in progress (or the last one); the close flush waits for it. Never rejects. */
  let saving: Promise<void> = Promise.resolve();
  const autosaveNow = (): Promise<void> => {
    clearTimeout(autosaveTimer);
    if (!autosaveDirty || restoring || !sessionReadable) return saving;
    autosaveDirty = false;
    saving = session.save(docs.snapshot(), docs.activeId).catch((e: unknown) => {
      console.error('[mockup-director] autosave failed', e);
      // Once per run: the work is still open, but would not come back after a restart.
      if (!autosaveFailureShown) {
        autosaveFailureShown = true;
        notify.error(t('errAutosave'), errorMessage(e));
      }
    });
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
    // A new / opened / restored document disposes the old document's image textures, which the
    // (locked) model of a running animation export still renders – stop the export before its next
    // frame instead of encoding frames with blank artwork.
    if (modelLocked && (e.source === 'project' || e.source === 'document')) animationAbort?.abort();
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

  /**
   * Opens project files, each in its own tab; the first may take the place of an untouched new tab.
   * A file that cannot be opened is reported and skipped.
   */
  /** Project files that arrived while an export ran; they open when it ends. */
  let waitingFiles: File[] = [];
  exportBusy.subscribe((busy) => {
    if (busy || !waitingFiles.length) return;
    const files = waitingFiles;
    waitingFiles = [];
    void openProjectFiles(files);
  });

  const openProjectFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return;
    if (exportBusy.value) {
      waitingFiles.push(...files);
      notify.info(t('openAfterExport', { n: files.length }));
      return;
    }
    document.body.classList.add('is-busy');
    try {
      for (const f of files) {
        try {
          let json: unknown;
          try {
            json = JSON.parse(await f.text());
          } catch {
            throw new ProjectError(t('errNotProject'));
          }
          const { state, failed } = await hydrateProject(parseProjectFile(json));
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
          notify.success(t('projectOpened'), f.name);
          if (failed) notify.warning(t('imagesFailed', { n: failed }));
        } catch (e) {
          notify.error(t('errOpen'), `${f.name}: ${errorMessage(e)}`);
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
      // (e.g. "DVD case" -> "DVD with disc"): same slot/param ids mean the same thing.
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
      safeStorage.set(LANG_KEY, lang);
      store.update(['lang'], (s) => {
        s.lang = lang;
      }, { history: false });
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
        notify.error(t('errOpen'), errorMessage(e));
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
        const suggested = `${docs.tab(tabId)?.name || t('defaultProjectName')}.${PROJECT_EXT}`;
        const saved = await saveBlob(blob, suggested, [{ name: t('projectFileType'), extensions: [PROJECT_EXT] }]);
        if (!saved) return false;
        docs.markSaved(tabId, revision, projectNameOf(saved));
        notify.success(t('projectSaved'), saved);
        return true;
      } catch (e) {
        notify.error(t('errSave'), errorMessage(e));
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
          title: t('unsavedTitle', { name: tabLabel(tab) }),
          message: t('unsavedMsg'),
          choices: [
            { id: 'save', label: t('save'), primary: true },
            { id: 'discard', label: t('dontSave'), danger: true },
            { id: 'cancel', label: t('cancel') },
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
        if (!blob || blob.size === 0) throw new Error(t('errExportEmpty'));
        const name = fileNameFor(s.modelId, settings.format);
        const ext = extensionFor(settings.format);
        const saved = await saveBlob(blob, name, [{ name: settings.format === 'jpeg' ? 'JPEG' : settings.format.toUpperCase(), extensions: [ext] }]);
        if (saved) notify.success(t('saved'), saved);
      } catch (e) {
        console.error('[mockup-director] export failed', e);
        notify.error(t('errExport'), errorMessage(e));
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
        let result;
        try {
          result = await exportAnimationBlob(stage, settings, { ...s.scene.background }, (p) => animationProgress.set(p), abort.signal);
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
        if (saved) notify.success(t('saved'), saved);
      } catch (e) {
        if (isAnimationCancelled(e)) {
          notify.info(t('animCancelled'));
        } else {
          console.error('[mockup-director] animation export failed', e);
          notify.error(t('errExportAnimation'), errorMessage(e));
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
        notify.warning(t('batchBusy'));
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
      // Decoding takes a while: the images belong to this tab, even if another one is shown by then.
      const tabId = docs.activeId;
      const keys = pairs.map((p) => `${model.id}/${p.slotId}`);
      setLoading(keys, true);
      try {
        const results = await Promise.allSettled(pairs.map((p) => loadImageFile(p.file)));
        const loaded: Record<string, ImageMap[string][string]> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') loaded[pairs[i].slotId] = r.value;
          else notify.error(t('errImage', { name: pairs[i].file.name }), errorMessage(r.reason));
        });
        if (Object.keys(loaded).length && !docs.tab(tabId)) {
          // The tab was closed meanwhile.
          Object.values(loaded).forEach(disposeImageAsset);
        } else if (Object.keys(loaded).length) {
          docs.activate(tabId);
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
        const saved = await saveBlob(blob, name, [{ name: 'PNG', extensions: ['png'] }]);
        if (saved) notify.success(t('saved'), saved);
      } catch (e) {
        notify.error(t('errTemplate'), errorMessage(e));
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
        console.error('[mockup-director] applySettings failed', e);
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
    h('div', { class: 'workspace' }, gallery.el, h('div', { class: 'workspace-center' }, tabBar.el, viewport.el), inspector.el),
  );

  /** The window title names the active project, with a • when it has unsaved changes. */
  const updateTitle = () => {
    const tab = docs.tab(docs.activeId);
    setWindowTitle(tab ? `${tabLabel(tab)}${tab.dirty ? ' •' : ''} – Mockup Director` : 'Mockup Director');
  };
  docs.subscribe(updateTitle);
  updateTitle();
  store.subscribe((e) => {
    if (e.kinds.has('lang')) {
      toolbar.render();
      tabBar.render();
      updateTitle();
    }
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

  restoreSession()
    .catch((e) => {
      console.error('[mockup-director] session restore failed', e);
      notify.error(t('errRestore'), errorMessage(e));
    })
    .finally(() => {
      restoring = false;
      // Edits made during the restore window were only marked dirty – save them now.
      if (autosaveDirty) scheduleAutosave();
      // Projects the operating system asked to open (a double-clicked .mdproj), each in a tab.
      void handleOpenedFiles(
        (files) => void openProjectFiles(files),
        (e) => notify.error(t('errOpen'), errorMessage(e)),
      );
    });

  /** Reopens the tabs of the last session (their unsaved changes included). */
  async function restoreSession(): Promise<void> {
    const loaded = await loadSession();
    // Read without an error (also when nothing was stored): autosave may write from now on.
    sessionReadable = true;
    if (!loaded) return;
    const { session: stored, skipped } = loaded;
    const restored: { id: string; name: string; dirty: boolean; state: DocumentState }[] = [];
    let failedImages = 0;
    for (const tab of stored.tabs) {
      const { state, failed } = await hydrateProject(tab.file);
      failedImages += failed;
      restored.push({ id: tab.id, name: tab.name, dirty: tab.dirty, state });
    }
    // The user may already have started working in the first tab while we were loading: keep it.
    const initial = docs.activeId;
    const replaceInitial = docs.activeIsPristine() && restored.length > 0;
    for (const r of restored) docs.add(r.state, { id: r.id, name: r.name, dirty: r.dirty, activate: false, position: 'end' });
    // Tab records that were not restored (damaged ones) are not the saver's to delete.
    session.adopt(restored.map((r) => r.id));
    if (replaceInitial) {
      docs.activate(restored.some((r) => r.id === stored.activeId) ? stored.activeId : restored[0].id);
      docs.close(initial);
    }
    if (restored.length) notify.info(t('restoredTabs', { n: restored.length }));
    if (skipped) notify.warning(t('restoreSkipped', { n: skipped }));
    if (failedImages) notify.warning(t('imagesFailed', { n: failedImages }));
  }
}
