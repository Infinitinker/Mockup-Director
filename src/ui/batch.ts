/**
 * Batch export: many still mockups at once, packed into ONE ZIP file.
 *
 * Modes:
 *  - images   – many artwork files → one model: every file replaces ONE chosen slot of the current
 *               model; all other slots, params and the scene stay as they are;
 *  - views    – the current project from several camera views (preset views + the current view);
 *  - projects – many *.mdproj files, each with its own model, params, images
 *               and scene; exported with the current export settings or each project's own.
 *
 * Correctness rules:
 *  - the batch NEVER touches the store (no undo entries, the document stays unchanged): every item is
 *    rendered from a TEMPORARY model built with the model's build() and temporary scene settings
 *    pushed straight to the stage;
 *  - the host (app.ts) freezes the document on the stage while the batch runs and restores the exact
 *    previous model, scene settings and camera afterwards (BatchHost.end() in a finally block);
 *  - temporary image textures / models are disposed once the stage no longer shows them;
 *  - one failing item (e.g. an image that cannot be decoded) is reported and skipped – the batch goes on;
 *  - Cancel stops after the current item; what is done can still be saved.
 */
import type * as THREE from 'three';
import type { ExportFormat, ExportSettings, ImageAsset, Lang, ModelContext, ParamValues, SceneSettings, StageAPI } from '../core/types';
import { cloneScene } from '../core/defaults';
import { getPlaceholderTexture } from '../core/placeholder';
import { IMAGE_ACCEPT, disposeImageAsset, loadImageFile } from '../core/images';
import { getModel } from '../models/registry';
import { pickFiles, saveBlob } from '../platform/files';
import { slugify } from '../export/exporter';
import { ZipLimitError, ZipWriter } from '../export/zip';
import { VIEW_PRESETS, type AppContext } from './context';
import { append, errorMessage, h, nextFrame, nextId, safeStorage, type Child } from './dom';
import { lt, t, type MessageKey } from '../i18n';
import { ICONS } from './icons';
import { segmentedControl, selectControl } from './controls';
import { completeParams, slotFor } from './modelUtils';
import { exportBlob, extensionFor, webpEncodingSupported } from './exportBridge';
import { PROJECT_EXT, ProjectError, hydrateProject, isProjectFileName, parseProjectFile } from './project';
import { disposeImageMap } from './state';
import { notify } from './toast';

/** Implemented by app.ts: exclusive access to the stage for the duration of a batch. */
export interface BatchHost {
  /**
   * Make the stage show the latest document, then freeze it (document rebuilds / scene updates are
   * deferred) and mark the export as busy. Returns false when another export is running.
   */
  begin(): boolean;
  /** Restore the document's model, scene settings and camera on the stage and clear the busy state. */
  end(): void;
}

export type BatchMode = 'images' | 'views' | 'projects';

/** Per-item outcome reported in the final summary. */
interface ItemNote {
  label: string;
  message: string;
}

interface BatchResult {
  zip: ZipWriter;
  total: number;
  done: number;
  errors: ItemNote[];
  warnings: ItemNote[];
  /** Stopped by the user before all items were processed. */
  cancelled: boolean;
  /** The ZIP size limit was reached; the remaining items were skipped. */
  limitHit: boolean;
}

interface RenderedItem {
  blob: Blob;
  format: ExportFormat;
  /** Non-fatal problem worth reporting (e.g. some project images failed to load). */
  warning?: string;
}

/** What an item may do with the (acquired) stage. */
interface Runner {
  stage: StageAPI;
  /**
   * Show a temporary model. `dispose` frees the item's own resources (image textures) and runs once
   * the stage no longer shows the model (after the next showModel() or after the batch).
   */
  showModel(object: THREE.Object3D, dispose: () => void): void;
}

interface BatchItem {
  label: string;
  /** File-name stem inside the ZIP (already slugified). */
  slug: string;
  render(r: Runner): Promise<RenderedItem>;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Build a NEW object tree of a model from explicit params / images (never from the store). */
function buildModel(modelId: string, params: ParamValues | undefined, images: Record<string, ImageAsset>, lang: Lang): THREE.Object3D {
  const model = getModel(modelId);
  const ctx: ModelContext = {
    params: completeParams(model, params),
    hasImage: (id) => !!images[id],
    getTexture: (id) => images[id]?.texture ?? getPlaceholderTexture(slotFor(model, id), lang),
  };
  return model.build(ctx);
}

/** Apply temporary scene settings and render one still image exactly like the normal export. */
async function renderStill(stage: StageAPI, settings: ExportSettings, scene: SceneSettings): Promise<RenderedItem> {
  stage.applySettings(scene);
  const s: ExportSettings = { ...settings };
  if (s.format === 'webp' && !webpEncodingSupported()) s.format = 'png';
  const blob = await exportBlob(stage, s, { ...scene.background });
  if (!blob || blob.size === 0) throw new Error(t('errExportEmpty'));
  return { blob, format: s.format };
}

/** "My Cover (final).png" → "my-cover-final" (max 60 chars, never empty). */
function slugOf(name: string): string {
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  return slugify(stem).slice(0, 60).replace(/-+$/, '') || 'mockup';
}

/** Unique entry name `<stem>.<ext>`, adding -2, -3 … on (unlikely) collisions. */
function uniqueName(zip: ZipWriter, stem: string, ext: string): string {
  let name = `${stem}.${ext}`;
  for (let n = 2; zip.has(name); n++) name = `${stem}-${n}.${ext}`;
  return name;
}

/**
 * Render every item into a ZIP. The caller must have called host.begin() successfully; host.end()
 * is always called here (finally), followed by the disposal of the last temporary resources.
 */
async function runBatch(
  items: BatchItem[],
  host: BatchHost,
  stage: StageAPI,
  onProgress: (index: number, label: string) => void,
  isCancelled: () => boolean,
): Promise<BatchResult> {
  const res: BatchResult = { zip: new ZipWriter(), total: items.length, done: 0, errors: [], warnings: [], cancelled: false, limitHit: false };
  let trash: (() => void)[] = [];
  const emptyTrash = (list: (() => void)[]) =>
    list.forEach((fn) => {
      try {
        fn();
      } catch {
        /* disposal must never break the batch */
      }
    });
  const runner: Runner = {
    stage,
    showModel(object, dispose) {
      stage.setModel(object); // disposes the previous temporary model's geometry / materials
      const old = trash;
      trash = [dispose];
      emptyTrash(old);
    },
  };
  const digits = Math.max(2, String(items.length).length);
  try {
    for (let i = 0; i < items.length; i++) {
      if (isCancelled()) {
        res.cancelled = true;
        break;
      }
      const item = items[i];
      onProgress(i, item.label);
      // Let the progress paint and keep the UI responsive between items.
      await nextFrame();
      try {
        const out = await item.render(runner);
        const name = uniqueName(res.zip, `${String(i + 1).padStart(digits, '0')}-${item.slug}`, extensionFor(out.format));
        await res.zip.add(name, out.blob);
        res.done += 1;
        if (out.warning) res.warnings.push({ label: item.label, message: out.warning });
      } catch (e) {
        if (e instanceof ZipLimitError) {
          res.limitHit = true;
          res.errors.push({ label: item.label, message: t('batchZipLimit') });
          break;
        }
        console.warn('[mockup-director] batch item failed', item.label, e);
        res.errors.push({ label: item.label, message: errorMessage(e) });
      }
    }
  } finally {
    host.end();
    emptyTrash(trash);
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

const MODE_KEY = 'mockup-director.ui.batchMode';
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|avif|heic|heif|bmp|tiff?)$/i;

/** Selections survive closing and reopening the dialog (within the session). */
const memory = {
  imageFiles: [] as File[],
  projectFiles: [] as File[],
  /** index 0 = current view, 1.. = VIEW_PRESETS[i - 1] */
  views: [true, ...VIEW_PRESETS.map(() => true)],
  ownExport: false,
  /** modelId → last slot chosen in "many images" mode */
  slots: new Map<string, string>(),
};

let dialogOpen = false;

const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_RE.test(f.name);
const isProjectFile = (f: File) => isProjectFileName(f.name);
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

function addUnique(list: File[], files: File[]): File[] {
  const seen = new Set(list.map(fileKey));
  const out = [...list];
  for (const f of files) {
    const k = fileKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/** "1600 × 1600 px · PNG · transparent background" – mirrors the Export panel summary. */
function settingsSummary(e: ExportSettings): string {
  const format = e.format === 'webp' && !webpEncodingSupported() ? 'png' : e.format;
  const fmt = format === 'jpeg' ? 'JPEG' : format === 'webp' ? 'WebP' : 'PNG';
  const transparent = e.background === 'transparent' && format !== 'jpeg';
  const size = e.sizing === 'trim' ? t('summaryTrim', { w: e.width, h: e.height }) : `${e.width} × ${e.height} px`;
  return `${size} · ${fmt} · ${transparent ? t('summaryTransparent') : t('summaryOpaque')}`;
}

/** Suggested archive name, e.g. mockup-director-batch-2026-11-05-1530.zip (local time). */
function zipFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `mockup-director-batch-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.zip`;
}

/** Default slot in "many images" mode: the remembered one, else 'front' when present, else the first slot. */
function defaultSlot(modelId: string): string {
  const model = getModel(modelId);
  const remembered = memory.slots.get(model.id);
  if (remembered && model.slots.some((s) => s.id === remembered)) return remembered;
  return model.slots.find((s) => s.id === 'front')?.id ?? model.slots[0]?.id ?? '';
}

type Phase = 'setup' | 'running' | 'result' | 'saved';

/** Open the batch export dialog (no-op while it is already open). */
export function openBatchDialog(ctx: AppContext, host: BatchHost): void {
  if (dialogOpen) return;
  dialogOpen = true;

  const stored = safeStorage.get(MODE_KEY);
  let mode: BatchMode = stored === 'views' || stored === 'projects' ? stored : 'images';
  let phase: Phase = 'setup';
  let cancelRequested = false;
  let result: BatchResult | null = null;
  let savedName = '';
  let slotId = defaultSlot(ctx.store.state.modelId);

  const prevFocus = document.activeElement as HTMLElement | null;
  const titleId = nextId('batch-title');
  const content = h('div', { class: 'batch-content' });
  const actions = h('div', { class: 'dialog-actions' });
  const dialog = h(
    'div',
    { class: 'dialog dialog-batch', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
    h('h2', { class: 'dialog-title', text: t('batchExport'), attrs: { id: titleId } }),
    content,
    actions,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);

  /* Progress elements (updated in place while running) ------------------- */
  const progressText = h('div', { class: 'anim-progress-text batch-progress-text', attrs: { 'aria-live': 'polite' } });
  const progressBar = h('div', { class: 'anim-progress-bar' });
  const progressTrack = h(
    'div',
    { class: 'anim-progress-track', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 } },
    progressBar,
  );
  const stoppingNote = h('p', { class: 'ctl-note', text: t('batchStopping'), attrs: { hidden: true } });

  const setProgress = (index: number, total: number, label: string) => {
    const pct = total ? Math.round((index / total) * 100) : 0;
    const text = index < total ? t('batchProgress', { i: index + 1, n: total, name: label }) : t('batchFinishing');
    progressText.textContent = text;
    progressBar.style.width = `${pct}%`;
    progressTrack.setAttribute('aria-valuenow', String(pct));
    progressTrack.setAttribute('aria-valuetext', text);
  };

  /* Helpers -------------------------------------------------------------- */
  const button = (text: string, cls: string, onClick: () => void, disabled = false) =>
    h('button', { class: `btn ${cls}`, text, attrs: { type: 'button', disabled }, on: { click: onClick } });

  const itemCount = (): number => {
    switch (mode) {
      case 'images':
        return getModel(ctx.store.state.modelId).slots.length ? memory.imageFiles.length : 0;
      case 'views':
        return memory.views.filter(Boolean).length;
      case 'projects':
        return memory.projectFiles.length;
    }
  };

  const fileList = (files: File[], onRemove: (i: number) => void): HTMLElement => {
    if (!files.length) return h('p', { class: 'ctl-note batch-empty', text: t('batchNoFiles') });
    const list = h('ul', { class: 'batch-list' });
    files.forEach((f, i) => {
      list.appendChild(
        h(
          'li',
          { class: 'batch-list-item' },
          h('span', { class: 'batch-list-name', text: f.name, title: f.name }),
          h('button', {
            class: 'btn btn-ghost btn-small btn-icon-only',
            html: ICONS.close,
            title: t('batchRemove'),
            label: `${t('batchRemove')}: ${f.name}`,
            attrs: { type: 'button' },
            on: { click: () => onRemove(i) },
          }),
        ),
      );
    });
    return list;
  };

  const pickInto = async (which: 'images' | 'projects') => {
    try {
      const files =
        which === 'images'
          ? (await pickFiles(IMAGE_ACCEPT, true)).filter(isImageFile)
          : (await pickFiles(`.${PROJECT_EXT}`, true)).filter(isProjectFile);
      if (!files.length) return;
      if (which === 'images') memory.imageFiles = addUnique(memory.imageFiles, files);
      else memory.projectFiles = addUnique(memory.projectFiles, files);
      render();
    } catch (e) {
      notify.error(t('errPick'), errorMessage(e));
    }
  };

  /* Setup phase ------------------------------------------------------------ */
  const renderImagesMode = (): Child[] => {
    const s = ctx.store.state;
    const model = getModel(s.modelId);
    const out: Child[] = [h('p', { class: 'batch-model', text: t('batchModel', { name: lt(model.name) }) })];
    if (!model.slots.length) {
      out.push(h('p', { class: 'ctl-note warn-note', text: t('noSlots') }));
      return out;
    }
    if (!model.slots.some((x) => x.id === slotId)) slotId = defaultSlot(model.id);
    const slotCtl = selectControl({
      label: t('batchSlot'),
      options: model.slots.map((x) => ({ value: x.id, label: lt(x.label) })),
      get: () => slotId,
      set: (v) => {
        slotId = v;
        memory.slots.set(model.id, v);
      },
    });
    out.push(
      slotCtl.el,
      h('p', { class: 'ctl-note', text: t('batchSlotHint') }),
      h(
        'div',
        { class: 'batch-pick' },
        h(
          'button',
          { class: 'btn', attrs: { type: 'button' }, on: { click: () => void pickInto('images') } },
          h('span', { class: 'btn-icon', html: ICONS.image }),
          h('span', { class: 'btn-text', text: t('batchPickImages') }),
        ),
        memory.imageFiles.length ? button(t('batchClear'), 'btn-ghost', () => {
              memory.imageFiles = [];
              render();
            }) : null,
      ),
      h('p', { class: 'ctl-note', text: t('batchDropHint') }),
      memory.imageFiles.length ? h('div', { class: 'batch-count', text: t('batchFilesCount', { n: memory.imageFiles.length }) }) : null,
      fileList(memory.imageFiles, (i) => {
        memory.imageFiles = memory.imageFiles.filter((_, j) => j !== i);
        render();
      }),
    );
    return out;
  };

  const renderViewsMode = (): Child[] => {
    const list = h('div', { class: 'batch-views', attrs: { role: 'group', 'aria-label': t('batchModeViews') } });
    const labels: string[] = [t('batchCurrentView'), ...VIEW_PRESETS.map((v) => t(v.key))];
    labels.forEach((label, i) => {
      const id = nextId('batch-view');
      const input = h('input', { attrs: { id, type: 'checkbox', checked: memory.views[i] } });
      input.addEventListener('change', () => {
        memory.views[i] = input.checked;
        syncSetup();
      });
      list.appendChild(h('label', { class: 'check-row', attrs: { for: id } }, input, h('span', { text: label })));
    });
    return [list];
  };

  const renderProjectsMode = (): Child[] => {
    const id = nextId('batch-own');
    const own = h('input', { attrs: { id, type: 'checkbox', checked: memory.ownExport } });
    own.addEventListener('change', () => {
      memory.ownExport = own.checked;
      syncSetup();
    });
    return [
      h(
        'div',
        { class: 'batch-pick' },
        h(
          'button',
          { class: 'btn', attrs: { type: 'button' }, on: { click: () => void pickInto('projects') } },
          h('span', { class: 'btn-icon', html: ICONS.open }),
          h('span', { class: 'btn-text', text: t('batchPickProjects') }),
        ),
        memory.projectFiles.length ? button(t('batchClear'), 'btn-ghost', () => {
              memory.projectFiles = [];
              render();
            }) : null,
      ),
      h('p', { class: 'ctl-note', text: t('batchDropHint') }),
      memory.projectFiles.length ? h('div', { class: 'batch-count', text: t('batchFilesCount', { n: memory.projectFiles.length }) }) : null,
      fileList(memory.projectFiles, (i) => {
        memory.projectFiles = memory.projectFiles.filter((_, j) => j !== i);
        render();
      }),
      h('label', { class: 'check-row batch-own', attrs: { for: id } }, own, h('span', { text: t('batchOwnExport') })),
    ];
  };

  const outputSummary = h('p', { class: 'batch-output-text' });
  let startBtn: HTMLButtonElement | null = null;

  /** Refresh the parts of the setup phase that depend on the selection. */
  const syncSetup = () => {
    const n = itemCount();
    const settings = mode === 'projects' && memory.ownExport ? t('batchOwnSettingsSummary') : settingsSummary(ctx.store.state.export);
    outputSummary.textContent = t('batchOutputSummary', { n, settings });
    if (startBtn) startBtn.disabled = n === 0;
  };

  const MODE_HINT: Record<BatchMode, MessageKey> = { images: 'batchModeImagesHint', views: 'batchModeViewsHint', projects: 'batchModeProjectsHint' };

  const renderSetup = () => {
    const modeCtl = segmentedControl<BatchMode>({
      ariaLabel: t('batchMode'),
      compact: true,
      options: [
        { value: 'images', label: t('batchModeImages'), title: t('batchModeImagesHint') },
        { value: 'views', label: t('batchModeViews'), title: t('batchModeViewsHint') },
        { value: 'projects', label: t('batchModeProjects'), title: t('batchModeProjectsHint') },
      ],
      get: () => mode,
      set: (v) => {
        mode = v;
        safeStorage.set(MODE_KEY, v);
        render();
        // render() replaced the focused segment – keep keyboard focus inside the dialog.
        content.querySelector<HTMLElement>('.batch-mode [aria-checked="true"]')?.focus();
      },
    });
    modeCtl.el.classList.add('batch-mode');
    const body = mode === 'images' ? renderImagesMode() : mode === 'views' ? renderViewsMode() : renderProjectsMode();
    content.replaceChildren(
      modeCtl.el,
      h('p', { class: 'dialog-message', text: t(MODE_HINT[mode]) }),
      h('div', { class: 'batch-body' }, ...body),
      h('div', { class: 'batch-output' }, h('div', { class: 'ctl-label', text: t('batchOutput') }), outputSummary),
    );
    startBtn = button(t('batchStart'), 'btn-primary', () => void start());
    actions.replaceChildren(button(t('close'), '', close), startBtn);
    syncSetup();
  };

  /* Running / result phases ------------------------------------------------ */
  const renderRunning = () => {
    stoppingNote.hidden = !cancelRequested;
    content.replaceChildren(h('div', { class: 'anim-progress batch-progress' }, progressText, progressTrack), stoppingNote);
    const cancel = button(t('cancel'), '', () => {
      cancelRequested = true;
      cancel.disabled = true;
      stoppingNote.hidden = false;
    });
    cancel.disabled = cancelRequested;
    actions.replaceChildren(cancel);
  };

  const noteList = (title: string, notes: ItemNote[], cls: string): HTMLElement | null => {
    if (!notes.length) return null;
    const list = h('ul', { class: `batch-notes ${cls}` });
    for (const n of notes) list.appendChild(h('li', {}, h('strong', { text: n.label }), h('span', { text: ` – ${n.message}` })));
    return h('div', { class: 'batch-notes-wrap' }, h('div', { class: 'ctl-label', text: title }), list);
  };

  const renderResult = () => {
    const r = result;
    if (!r) return;
    const status =
      phase === 'saved'
        ? t('batchSavedAs', { name: savedName })
        : r.cancelled
          ? t('batchCancelledMsg', { done: r.done, n: r.total })
          : t('batchDone', { done: r.done, n: r.total });
    content.replaceChildren();
    append(
      content,
      h('p', { class: `batch-status${r.errors.length ? ' has-errors' : ''}`, text: status }),
      r.done === 0 ? h('p', { class: 'ctl-note warn-note', text: t('batchNothing') }) : null,
      noteList(t('batchErrors', { n: r.errors.length }), r.errors, 'is-error'),
      noteList(t('batchWarnings', { n: r.warnings.length }), r.warnings, 'is-warning'),
    );
    if (phase === 'saved' || r.done === 0) {
      actions.replaceChildren(button(t('close'), 'btn-primary', close));
    } else {
      const save = button(t('batchSaveZip'), 'btn-primary', () => void saveResult(save));
      actions.replaceChildren(button(t('batchDiscard'), '', close), save);
    }
  };

  const render = () => {
    if (phase === 'setup') renderSetup();
    else if (phase === 'running') renderRunning();
    else renderResult();
  };

  /* Building the items --------------------------------------------------- */
  const buildItems = (): BatchItem[] => {
    const s = ctx.store.state;
    const lang = s.lang;
    const settings: ExportSettings = { ...s.export };
    const scene = cloneScene(s.scene);
    switch (mode) {
      case 'images': {
        const model = getModel(s.modelId);
        if (!model.slots.some((x) => x.id === slotId)) return [];
        const params = completeParams(model, s.params[model.id]);
        // The document's assets stay owned by the store (alive while the dialog blocks the UI).
        const baseImages: Record<string, ImageAsset> = { ...(s.images[model.id] ?? {}) };
        const slot = slotId;
        return memory.imageFiles.map((file) => ({
          label: file.name,
          slug: slugOf(file.name),
          async render(r: Runner): Promise<RenderedItem> {
            const asset = await loadImageFile(file);
            let object: THREE.Object3D;
            try {
              object = buildModel(model.id, params, { ...baseImages, [slot]: asset }, lang);
            } catch (e) {
              disposeImageAsset(asset);
              throw e;
            }
            r.showModel(object, () => disposeImageAsset(asset));
            return renderStill(r.stage, settings, scene);
          },
        }));
      }
      case 'views': {
        const items: BatchItem[] = [];
        if (memory.views[0]) {
          items.push({
            label: t('batchCurrentView'),
            slug: slugOf(t('batchCurrentView')),
            render: (r) => renderStill(r.stage, settings, scene),
          });
        }
        VIEW_PRESETS.forEach((v, i) => {
          if (!memory.views[i + 1]) return;
          const label = t(v.key);
          // Same camera change as the preset-view action (keeps fov, zoom and projection).
          const viewScene: SceneSettings = { ...scene, camera: { ...scene.camera, yaw: v.yaw, pitch: v.pitch, roll: 0, panX: 0, panY: 0 } };
          items.push({ label, slug: slugOf(label), render: (r) => renderStill(r.stage, settings, viewScene) });
        });
        return items;
      }
      case 'projects': {
        const ownExport = memory.ownExport;
        return memory.projectFiles.map((file) => ({
          label: file.name,
          slug: slugOf(file.name),
          async render(r: Runner): Promise<RenderedItem> {
            let json: unknown;
            try {
              json = JSON.parse(await file.text());
            } catch {
              throw new ProjectError(t('errNotProject'));
            }
            const parsed = parseProjectFile(json);
            // Only the shown model's images are needed – don't decode artwork of other models.
            const own = parsed.images[parsed.modelId];
            const { state, failed } = await hydrateProject({ ...parsed, images: own ? { [parsed.modelId]: own } : {} });
            let object: THREE.Object3D;
            try {
              object = buildModel(state.modelId, state.params[state.modelId], state.images[state.modelId] ?? {}, lang);
            } catch (e) {
              disposeImageMap(state.images);
              throw e;
            }
            r.showModel(object, () => disposeImageMap(state.images));
            const out = await renderStill(r.stage, ownExport ? state.export : settings, state.scene);
            if (failed) out.warning = t('imagesFailed', { n: failed });
            return out;
          },
        }));
      }
    }
  };

  /* Actions ---------------------------------------------------------------- */
  const start = async () => {
    if (phase !== 'setup') return;
    const items = buildItems();
    if (!items.length) return;
    if (!host.begin()) {
      notify.warning(t('batchBusy'));
      return;
    }
    try {
      phase = 'running';
      cancelRequested = false;
      setProgress(0, items.length, items[0].label);
      render();
      actions.querySelector('button')?.focus();
      result = await runBatch(
        items,
        host,
        ctx.stage,
        (i, label) => setProgress(i, items.length, label),
        () => cancelRequested,
      );
    } catch (e) {
      // runBatch() reports item errors itself; this is an unexpected failure of the batch as a whole.
      console.error('[mockup-director] batch export failed', e);
      host.end(); // idempotent – runBatch() normally ends the session itself
      notify.error(t('errBatch'), errorMessage(e));
      result = null;
      phase = 'setup';
      render();
      return;
    }
    phase = 'result';
    render();
    actions.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
  };

  const saveResult = async (btn: HTMLButtonElement) => {
    const r = result;
    if (!r || r.done === 0) return;
    btn.disabled = true;
    try {
      const name = zipFileName();
      const ok = await saveBlob(r.zip.finish(), name, [{ name: 'ZIP', extensions: ['zip'] }]);
      if (!ok) return; // save panel cancelled – keep the results
      savedName = name;
      phase = 'saved';
      notify.success(t('batchSaved'), name);
      render();
      actions.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
    } catch (e) {
      notify.error(t('errBatch'), errorMessage(e));
    } finally {
      btn.disabled = false;
    }
  };

  /* Drop files onto the dialog -------------------------------------------- */
  dialog.addEventListener('dragover', (e) => {
    if (phase !== 'setup') return;
    e.preventDefault();
    dialog.classList.add('is-drop-target');
  });
  dialog.addEventListener('dragleave', (e) => {
    if (e.target === dialog) dialog.classList.remove('is-drop-target');
  });
  dialog.addEventListener('drop', (e) => {
    e.preventDefault();
    dialog.classList.remove('is-drop-target');
    if (phase !== 'setup') return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const projects = files.filter(isProjectFile);
    const images = files.filter((f) => !isProjectFile(f) && isImageFile(f));
    if (!projects.length && !images.length) {
      notify.warning(t('batchUnsupportedDrop'));
      return;
    }
    // Switch to the mode the dropped files belong to. When both kinds are dropped, a file mode that is
    // already shown stays; from "many views" the projects win.
    if (projects.length) memory.projectFiles = addUnique(memory.projectFiles, projects);
    if (images.length) memory.imageFiles = addUnique(memory.imageFiles, images);
    if (!images.length) mode = 'projects';
    else if (!projects.length) mode = 'images';
    else if (mode === 'views') mode = 'projects';
    safeStorage.set(MODE_KEY, mode);
    render();
  });

  /* Open / close ----------------------------------------------------------- */
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (phase === 'setup' || phase === 'saved' || (phase === 'result' && result?.done === 0)) close();
      else if (phase === 'running' && !cancelRequested) {
        cancelRequested = true;
        renderRunning();
      }
      // With unsaved results Escape does nothing – the user chooses Save or Discard explicitly.
    } else if (e.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(
        (x) => !x.hasAttribute('disabled') && x.tabIndex !== -1,
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus can fall back to <body> when a re-render removes the focused element – pull it back in.
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  function close(): void {
    if (phase === 'running') return;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('show');
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 160);
    result = null; // release the encoded images
    dialogOpen = false;
    try {
      prevFocus?.focus();
    } catch {
      /* ignore */
    }
  }

  // On the document (not the backdrop) so Escape also works when nothing inside the dialog has focus.
  // Global shortcuts ignore keys while a .modal-backdrop is present (see shortcuts.ts).
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && phase === 'setup') close();
  });
  render();
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  (actions.querySelector<HTMLButtonElement>('.btn-primary:not(:disabled)') ?? dialog.querySelector<HTMLElement>('button'))?.focus();
}
