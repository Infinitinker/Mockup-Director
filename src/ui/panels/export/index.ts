/**
 * The Export tab with its two export types:
 *  - Image: output size, margin, sizing mode, format, quality and background (the toolbar's
 *    Export button always exports this still image) plus "Batch export…", which opens the batch
 *    export dialog (src/ui/dialogs/batch/: many mockups with these settings → one ZIP); see still.ts;
 *  - Animation: turntable motion, size, GIF / WebP / MP4 options, its own Export button
 *    and a progress indicator with Cancel while the animation is rendered; see animation.ts.
 */
import type { AnimationFormat } from '../../../core/types/export';
import { hasAny } from '../../../documents/store';
import { safeStorage } from '../../../platform/storage';
import type { AppContext } from '../../context';
import type { AddControl, Control } from '../../controls';
import { segmentedControl } from '../../controls/segmented';
import { h } from '../../dom';
import { ICONS } from '../../icons';
import { animationSections } from './animation';
import { createAnimationProgress } from './animationProgress';
import { animationOf } from './settings';
import { animationDims, createAspectLock, stillDims } from './size';
import { stillSections } from './still';

const MODE_KEY = 'mockup-director.ui.exportMode';

/** The export type; its values are stored as `mockup-director.ui.exportMode`. */
type ExportType = 'image' | 'animation';

export function createExportPanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-export' });
  let controls: Control[] = [];
  const lock = createAspectLock();
  let mode: ExportType = safeStorage.get(MODE_KEY) === 'animation' ? 'animation' : 'image';
  let exportBtn: HTMLButtonElement | null = null;
  let animBtn: HTMLButtonElement | null = null;
  let batchBtn: HTMLButtonElement | null = null;
  /** Format the animation controls were built for (limits such as the fps range depend on it). */
  let renderedFormat: AnimationFormat | null = null;

  const imageDims = stillDims(ctx);
  const animDims = animationDims(ctx);
  const progress = createAnimationProgress(ctx);

  const render = () => {
    el.replaceChildren();
    controls = [];
    exportBtn = null;
    animBtn = null;
    batchBtn = null;
    const add: AddControl = (c) => {
      controls.push(c);
      return c;
    };

    const modeCtl = segmentedControl<ExportType>({
      ariaLabel: 'Export type',
      compact: true,
      options: [
        { value: 'image', label: 'Image', icon: ICONS.image },
        { value: 'animation', label: 'Animation', icon: ICONS.reset },
      ],
      get: () => mode,
      set: (v) => {
        mode = v;
        safeStorage.set(MODE_KEY, v);
        render();
        syncAll();
      },
    });
    modeCtl.el.classList.add('export-mode');

    let parts: HTMLElement[];
    if (mode === 'animation') {
      renderedFormat = animationOf(ctx).format;
      const animation = animationSections(ctx, animDims, lock, add);
      parts = animation.parts;
      animBtn = animation.animBtn;
    } else {
      const still = stillSections(ctx, imageDims, lock, add);
      parts = still.parts;
      exportBtn = still.exportBtn;
      batchBtn = still.batchBtn;
    }
    el.append(modeCtl.el, ...parts, progress.el);
    updateBusy(ctx.exportBusy.value);
    progress.update(ctx.animationProgress.value);
  };

  const updateBusy = (busy: boolean) => {
    const animating = busy && ctx.animationProgress.value !== null;
    if (exportBtn) {
      exportBtn.disabled = busy;
      exportBtn.classList.toggle('busy', busy && !animating);
      const text = exportBtn.querySelector('.btn-text');
      if (text) text.textContent = busy && !animating ? 'Exporting…' : 'Export image…';
    }
    if (batchBtn) batchBtn.disabled = busy;
    if (animBtn) {
      animBtn.disabled = busy;
      animBtn.classList.toggle('busy', animating);
      const text = animBtn.querySelector('.btn-text');
      if (text) text.textContent = animating ? 'Exporting…' : 'Export animation…';
    }
  };

  const syncAll = () =>
    controls.forEach((c) => {
      c.sync();
    });
  ctx.store.subscribe((e) => {
    if (hasAny(e, 'export', 'scene')) {
      if (mode === 'animation' && animationOf(ctx).format !== renderedFormat) render();
      syncAll();
    }
  });
  ctx.exportBusy.subscribe(updateBusy);
  ctx.animationProgress.subscribe((p) => {
    progress.update(p);
    updateBusy(ctx.exportBusy.value);
  });
  render();
  syncAll();
  return { el };
}
