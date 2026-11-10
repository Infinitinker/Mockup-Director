/**
 * "Export" tab with two modes:
 *  - Image: output size, margin, sizing mode, format, quality and background (the toolbar's
 *    Export button always exports this still image) plus "Batch export…", which opens the batch
 *    export dialog (src/ui/batch.ts: many mockups with these settings → one ZIP);
 *  - Animation: turntable motion, size, GIF / WebP / MP4 options, its own Export button
 *    and a progress indicator with Cancel while the animation is rendered.
 */
import type { AnimationFormat, AnimationSettings, ExportFormat, ExportSettings } from '../../core/types';
import {
  DEFAULT_ANIMATION,
  MAX_ANIMATION_DURATION,
  MAX_EXPORT_SIZE,
  MIN_ANIMATION_DURATION,
  MIN_ANIMATION_SIZE,
} from '../../core/defaults';
import type { AppContext } from '../context';
import { formatNumber } from '../numbers';
import { clamp } from '../../core/math';
import { h, nextId, shortcutLabel } from '../dom';
import { safeStorage } from '../../platform/storage';
import { ICONS } from '../icons';
import { numberControl, section, segmentedControl, selectControl, switchControl, type Control } from '../controls';
import { hasAny } from '../../documents/store';
import { animationFormatSupport, IMAGE_FORMAT_LABEL, supportsWebpEncoding } from '../../export/formats';
import {
  defaultFpsFor,
  frameCountOf,
  maxFpsFor,
  maxMarginFor,
  maxSizeFor,
  outputSizeOf,
} from '../../export/animation/settings';
import { MP4_UNSUPPORTED, WEBP_ANIMATION_UNSUPPORTED, type AnimationProgress } from '../../export/animation';
import { WEBP_IMAGE_UNSUPPORTED } from '../../export/exporter';

const SIZE_PRESETS = [800, 1200, 1600, 2000, 3000, 4000];
const ANIM_SIZE_PRESETS = [480, 640, 800, 1080, 1200, 1920];
const MIN_SIZE = 16;
const LOCK_KEY = 'mockup-director.ui.lockAspect';
const MODE_KEY = 'mockup-director.ui.exportMode';

type Mode = 'image' | 'animation';

/** Width / height pair edited by the dimension fields (still image or animation). */
interface DimTarget {
  get(which: 'width' | 'height'): number;
  set(w: number, h: number): void;
  max(): number;
  min: number;
}

const FORMAT_LABEL: Record<AnimationFormat, string> = { gif: 'GIF', webp: 'WebP', mp4: 'MP4' };

const SIZING_HINT: Record<ExportSettings['sizing'], string> = {
  canvas: 'The image has exactly the given size, with the object centered.',
  trim: 'The image is cropped to the object plus the margin: one side is usually smaller.',
};
const USE_VIEW_HINT =
  'Off: the whole composition always fits. On: the preview’s zoom and pan are applied on top of the fixed framing, which may crop it.';

export function createExportPanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-export' });
  let controls: Control[] = [];
  let lockAspect = safeStorage.get(LOCK_KEY) !== '0';
  let mode: Mode = safeStorage.get(MODE_KEY) === 'animation' ? 'animation' : 'image';
  let exportBtn: HTMLButtonElement | null = null;
  let animBtn: HTMLButtonElement | null = null;
  let batchBtn: HTMLButtonElement | null = null;
  /** Format the animation controls were built for (limits such as the fps range depend on it). */
  let renderedFormat: AnimationFormat | null = null;

  const ex = () => ctx.store.state.export;
  const upd = (fn: (e: ExportSettings) => void) => ctx.store.update(['export'], (s) => fn(s.export));
  /** Current animation settings (defaults until the user changes something). */
  const an = (): AnimationSettings => ex().animation ?? DEFAULT_ANIMATION;
  /** Mutate the animation settings (created from a COPY of the defaults on first use). */
  const updA = (fn: (a: AnimationSettings) => void) =>
    upd((e) => {
      e.animation ??= { ...DEFAULT_ANIMATION };
      fn(e.animation);
    });

  const setSize = (w: number, h2: number) =>
    upd((e) => {
      e.width = Math.round(clamp(w, MIN_SIZE, MAX_EXPORT_SIZE));
      e.height = Math.round(clamp(h2, MIN_SIZE, MAX_EXPORT_SIZE));
      e.margin = Math.min(e.margin, Math.floor(Math.min(e.width, e.height) / 2) - 1);
    });

  const setAnimSize = (w: number, h2: number) =>
    updA((a) => {
      const max = maxSizeFor(a.format);
      a.width = Math.round(clamp(w, MIN_ANIMATION_SIZE, max));
      a.height = Math.round(clamp(h2, MIN_ANIMATION_SIZE, max));
      a.margin = Math.min(a.margin, maxMarginFor(a.width, a.height));
    });

  const imageDims: DimTarget = { get: (w) => ex()[w], set: setSize, max: () => MAX_EXPORT_SIZE, min: MIN_SIZE };
  const animDims: DimTarget = {
    get: (w) => an()[w],
    set: setAnimSize,
    max: () => maxSizeFor(an().format),
    min: MIN_ANIMATION_SIZE,
  };

  /** Width/height numeric field with lock-aspect behavior. */
  const dimField = (which: 'width' | 'height', target: DimTarget): Control => {
    const id = nextId('dim');
    const input = h('input', {
      class: 'num-input',
      attrs: { id, type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false' },
    });
    const el = h(
      'div',
      { class: 'dim-field' },
      h('label', { class: 'ctl-label', text: which === 'width' ? 'Width' : 'Height', attrs: { for: id } }),
      h('span', { class: 'num-wrap' }, input, h('span', { class: 'unit', text: 'px' })),
    );
    const commit = () => {
      const n = Number(input.value.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        sync();
        return;
      }
      const max = target.max();
      const cw = target.get('width');
      const chh = target.get('height');
      const v = clamp(Math.round(n), target.min, max);
      if (which === 'width') {
        let hh = chh;
        if (lockAspect && cw > 0) hh = (chh / cw) * v;
        // Keep the other side inside the limit too (scale both down proportionally).
        if (hh > max) target.set((v * max) / hh, max);
        else target.set(v, hh);
      } else {
        let ww = cw;
        if (lockAspect && chh > 0) ww = (cw / chh) * v;
        if (ww > max) target.set(max, (v * max) / ww);
        else target.set(ww, v);
      }
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        input.select();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = Number(input.value) || target.get(which);
        input.value = String(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 100 : 10));
        commit();
      }
    });
    const sync = () => {
      if (document.activeElement !== input) input.value = String(target.get(which));
    };
    sync();
    return { el, sync };
  };

  const lockButton = (): HTMLButtonElement => {
    const lockBtn = h('button', {
      class: `btn btn-icon-only lock-btn${lockAspect ? ' active' : ''}`,
      html: lockAspect ? ICONS.lock : ICONS.unlock,
      title: 'Lock aspect ratio',
      attrs: { type: 'button', 'aria-pressed': String(lockAspect), 'aria-label': 'Lock aspect ratio' },
      on: {
        click: () => {
          lockAspect = !lockAspect;
          safeStorage.set(LOCK_KEY, lockAspect ? '1' : '0');
          lockBtn.classList.toggle('active', lockAspect);
          lockBtn.innerHTML = lockAspect ? ICONS.lock : ICONS.unlock;
          lockBtn.setAttribute('aria-pressed', String(lockAspect));
        },
      },
    });
    return lockBtn;
  };

  /** Square size preset chips. `disabled(n)` grays out presets above the format's limit. */
  const sizeChips = (presets: number[], target: DimTarget, add: <T extends Control>(c: T) => T): HTMLElement => {
    const chips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': 'Size presets (square)' } });
    const chipButtons = presets.map((n) => {
      const b = h('button', {
        class: 'chip',
        text: `${n}`,
        title: `${n} × ${n} px`,
        attrs: { type: 'button' },
        on: { click: () => target.set(n, n) },
      });
      chips.appendChild(b);
      return b;
    });
    add({
      el: chips,
      sync: () =>
        chipButtons.forEach((b, i) => {
          const n = presets[i];
          const on = target.get('width') === n && target.get('height') === n;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
          b.disabled = n > target.max();
        }),
    });
    return chips;
  };

  /* ================================================================ */
  /* Image mode                                                        */
  /* ================================================================ */

  const renderImage = (add: <T extends Control>(c: T) => T): HTMLElement[] => {
    /* Size --------------------------------------------------------- */
    const chips = sizeChips(SIZE_PRESETS, imageDims, add);
    const wField = add(dimField('width', imageDims));
    const hField = add(dimField('height', imageDims));
    const dims = h(
      'div',
      { class: 'dims' },
      wField.el,
      h('span', { class: 'dims-x', text: '×' }),
      hField.el,
      lockButton(),
    );
    const margin = add(
      numberControl({
        label: 'Margin',
        min: 0,
        max: 400,
        step: 1,
        unit: 'px',
        inputMax: MAX_EXPORT_SIZE / 2 - 1,
        get: () => ex().margin,
        set: (v) =>
          upd((e) => {
            e.margin = Math.round(clamp(v, 0, Math.floor(Math.min(e.width, e.height) / 2) - 1));
          }),
      }),
    );
    const sizing = add(
      segmentedControl<ExportSettings['sizing']>({
        label: 'Framing',
        options: [
          {
            value: 'canvas',
            label: 'Fit to canvas',
            title: SIZING_HINT.canvas,
          },
          {
            value: 'trim',
            label: 'Trim to object',
            title: SIZING_HINT.trim,
          },
        ],
        get: () => ex().sizing,
        set: (v) => upd((e) => (e.sizing = v)),
      }),
    );
    const sizingNote = h('p', { class: 'ctl-note' });
    add({
      el: sizingNote,
      sync: () => (sizingNote.textContent = SIZING_HINT[ex().sizing]),
    });

    const sizeSection = section('export.size', 'Size', [
      h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', text: 'Size presets (square)' }), chips),
      dims,
      h('p', { class: 'ctl-note', text: `The largest size is ${MAX_EXPORT_SIZE} × ${MAX_EXPORT_SIZE} px.` }),
      margin.el,
      sizing.el,
      sizingNote,
    ]);

    /* Format ------------------------------------------------------- */
    const webp = supportsWebpEncoding();
    const format = add(
      segmentedControl<ExportFormat>({
        label: 'Format',
        options: [
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
          {
            value: 'webp',
            label: 'WebP',
            disabled: !webp,
            title: webp ? 'WebP' : WEBP_IMAGE_UNSUPPORTED,
          },
        ],
        get: () => ex().format,
        set: (v) => upd((e) => (e.format = v)),
      }),
    );
    const quality = add(
      numberControl({
        label: 'Quality',
        min: 0.5,
        max: 1,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        inputMin: 0.1,
        get: () => ex().quality,
        set: (v) => upd((e) => (e.quality = v)),
      }),
    );
    add({ el: quality.el, sync: () => (quality.el.hidden = ex().format === 'png') });
    const background = add(
      segmentedControl<ExportSettings['background']>({
        label: 'Background',
        options: [
          { value: 'transparent', label: 'Transparent', title: 'Transparent (checkerboard)' },
          { value: 'scene', label: 'As preview' },
        ],
        get: () => ex().background,
        set: (v) => upd((e) => (e.background = v)),
      }),
    );
    const jpegNote = h('p', {
      class: 'ctl-note warn-note',
      text: 'JPEG has no transparency: the background will be white.',
    });
    add({
      el: jpegNote,
      sync: () => (jpegNote.hidden = !(ex().format === 'jpeg' && ex().background === 'transparent')),
    });
    const formatSection = section('export.format', 'Format & background', [
      format.el,
      !webp ? h('p', { class: 'ctl-note', text: WEBP_IMAGE_UNSUPPORTED }) : null,
      quality.el,
      background.el,
      jpegNote,
    ]);

    /* Summary + button --------------------------------------------- */
    const summary = h('div', { class: 'export-summary' });
    add({
      el: summary,
      sync: () => {
        const e = ex();
        const fmt = IMAGE_FORMAT_LABEL[e.format];
        const transparent = e.background === 'transparent' && e.format !== 'jpeg';
        const size =
          e.sizing === 'trim' ? `up to ${e.width} × ${e.height} px (trimmed)` : `${e.width} × ${e.height} px`;
        summary.textContent = `${size} · ${fmt} · ${transparent ? 'transparent background' : 'with background'}`;
      },
    });
    exportBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-large export-btn',
        title: `Export image… (${shortcutLabel('E')})`,
        attrs: { type: 'button' },
        on: { click: () => void ctx.actions.exportImage() },
      },
      h('span', { class: 'spinner small' }),
      h('span', { class: 'btn-icon', html: ICONS.exportImg }),
      h('span', { class: 'btn-text', text: 'Export image…' }),
    );
    batchBtn = h(
      'button',
      {
        class: 'btn batch-btn',
        title: 'Exports many mockups at once into one ZIP file, with the current export settings.',
        attrs: { type: 'button' },
        on: { click: () => ctx.actions.openBatchExport() },
      },
      h('span', { class: 'btn-icon', html: ICONS.folderImg }),
      h('span', { class: 'btn-text', text: 'Batch export…' }),
    );
    const footer = h('div', { class: 'export-footer' }, summary, exportBtn, batchBtn);
    return [sizeSection, formatSection, footer];
  };

  /* ================================================================ */
  /* Animation mode                                                    */
  /* ================================================================ */

  const renderAnimation = (add: <T extends Control>(c: T) => T): HTMLElement[] => {
    const support = animationFormatSupport();
    renderedFormat = an().format;

    /* Motion ------------------------------------------------------- */
    const motion = add(
      segmentedControl<AnimationSettings['motion']>({
        label: 'Motion type',
        options: [
          { value: 'loop', label: '360° turn' },
          { value: 'swing', label: 'Swing' },
        ],
        get: () => an().motion,
        set: (v) => updA((a) => (a.motion = v)),
      }),
    );
    const motionNote = h('p', { class: 'ctl-note' });
    add({
      el: motionNote,
      sync: () =>
        (motionNote.textContent =
          an().motion === 'loop'
            ? 'The model turns a full 360° at constant speed: the animation loops seamlessly.'
            : `The model turns back and forth by ±${an().swingAngle}° around the current view.`),
    });
    const swingAngle = add(
      numberControl({
        label: 'Swing angle (±)',
        min: 5,
        max: 90,
        step: 1,
        unit: '°',
        inputMin: 1,
        inputMax: 180,
        get: () => an().swingAngle,
        set: (v) => updA((a) => (a.swingAngle = Math.round(clamp(v, 1, 180)))),
      }),
    );
    const easing = add(
      segmentedControl<AnimationSettings['easing']>({
        label: 'Easing',
        options: [
          { value: 'sine', label: 'Smooth (sine)' },
          { value: 'linear', label: 'Linear' },
        ],
        get: () => an().easing,
        set: (v) => updA((a) => (a.easing = v)),
      }),
    );
    add({
      el: swingAngle.el,
      sync: () => {
        const swing = an().motion === 'swing';
        swingAngle.el.hidden = !swing;
        easing.el.hidden = !swing;
      },
    });
    const direction = add(
      segmentedControl<AnimationSettings['direction']>({
        label: 'Direction (seen from above)',
        options: [
          { value: 'cw', label: 'Clockwise' },
          { value: 'ccw', label: 'Counterclockwise' },
        ],
        get: () => an().direction,
        set: (v) => updA((a) => (a.direction = v)),
      }),
    );
    const duration = add(
      numberControl({
        label: 'Duration',
        min: MIN_ANIMATION_DURATION,
        max: MAX_ANIMATION_DURATION,
        step: 0.5,
        unit: 's',
        decimals: 1,
        get: () => an().duration,
        set: (v) =>
          updA((a) => (a.duration = clamp(Math.round(v * 10) / 10, MIN_ANIMATION_DURATION, MAX_ANIMATION_DURATION))),
      }),
    );
    const fps = add(
      numberControl({
        label: 'Frames per second',
        min: 5,
        max: maxFpsFor(an().format), // the panel is re-rendered when the format changes
        step: 1,
        unit: 'fps',
        inputMin: 1,
        get: () => an().fps,
        set: (v) => updA((a) => (a.fps = Math.round(clamp(v, 1, maxFpsFor(a.format))))),
      }),
    );
    const useView = add(
      switchControl({
        label: 'Zoom & pan from the preview',
        title: USE_VIEW_HINT,
        get: () => an().useViewZoomPan,
        set: (v) => updA((a) => (a.useViewZoomPan = v)),
      }),
    );
    const motionSection = section('export.anim.motion', 'Motion', [
      h('p', {
        class: 'ctl-note',
        text: 'The animation starts from the current view: the camera angle, light, shadow and reflection are kept, and the framing is fixed for all frames.',
      }),
      motion.el,
      motionNote,
      swingAngle.el,
      easing.el,
      direction.el,
      duration.el,
      fps.el,
      useView.el,
      h('p', { class: 'ctl-note', text: USE_VIEW_HINT }),
    ]);

    /* Size --------------------------------------------------------- */
    const chips = sizeChips(ANIM_SIZE_PRESETS, animDims, add);
    const wField = add(dimField('width', animDims));
    const hField = add(dimField('height', animDims));
    const dims = h(
      'div',
      { class: 'dims' },
      wField.el,
      h('span', { class: 'dims-x', text: '×' }),
      hField.el,
      lockButton(),
    );
    const maxNote = h('p', { class: 'ctl-note' });
    add({
      el: maxNote,
      sync: () =>
        (maxNote.textContent = `${FORMAT_LABEL[an().format]} allows at most ${maxSizeFor(an().format)} px per side.`),
    });
    const evenNote = h('p', { class: 'ctl-note warn-note' });
    add({
      el: evenNote,
      sync: () => {
        const a = an();
        const o = outputSizeOf(a);
        evenNote.hidden = !(a.format === 'mp4' && (o.width !== a.width || o.height !== a.height));
        evenNote.textContent = `MP4 needs even dimensions: the file will be ${o.width} × ${o.height} px.`;
      },
    });
    const margin = add(
      numberControl({
        label: 'Margin',
        min: 0,
        max: 200,
        step: 1,
        unit: 'px',
        inputMax: 944,
        get: () => an().margin,
        set: (v) => updA((a) => (a.margin = Math.round(clamp(v, 0, maxMarginFor(a.width, a.height))))),
      }),
    );
    const sizeSection = section('export.anim.size', 'Size', [
      h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', text: 'Size presets (square)' }), chips),
      dims,
      maxNote,
      evenNote,
      margin.el,
    ]);

    /* Format ------------------------------------------------------- */
    const format = add(
      segmentedControl<AnimationFormat>({
        label: 'Format',
        options: [
          { value: 'gif', label: 'GIF' },
          {
            value: 'webp',
            label: 'WebP',
            disabled: !support.webp,
            title: support.webp ? 'WebP' : WEBP_ANIMATION_UNSUPPORTED,
          },
          {
            value: 'mp4',
            label: 'MP4',
            disabled: !support.mp4,
            title: support.mp4 ? 'MP4 (H.264)' : MP4_UNSUPPORTED,
          },
        ],
        get: () => an().format,
        set: (v) =>
          updA((a) => {
            const prev = a.format;
            a.format = v;
            // Switch to the new format's default fps when the old default was in use.
            if (a.fps === defaultFpsFor(prev)) a.fps = defaultFpsFor(v);
            a.fps = Math.min(a.fps, maxFpsFor(v));
            // Fit the size into the new limit, keeping the aspect ratio.
            const max = maxSizeFor(v);
            const k = Math.min(1, max / Math.max(a.width, a.height));
            if (k < 1) {
              a.width = Math.max(MIN_ANIMATION_SIZE, Math.round(a.width * k));
              a.height = Math.max(MIN_ANIMATION_SIZE, Math.round(a.height * k));
            }
            a.margin = Math.min(a.margin, maxMarginFor(a.width, a.height));
          }),
      }),
    );
    const unsupportedNotes: HTMLElement[] = [];
    if (!support.webp) unsupportedNotes.push(h('p', { class: 'ctl-note', text: WEBP_ANIMATION_UNSUPPORTED }));
    if (!support.mp4) unsupportedNotes.push(h('p', { class: 'ctl-note', text: MP4_UNSUPPORTED }));

    const qualityLabels: Record<AnimationSettings['quality'], string> = {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    };
    const quality = add(
      segmentedControl<AnimationSettings['quality']>({
        label: 'Quality',
        options: (['low', 'medium', 'high'] as const).map((q) => ({ value: q, label: qualityLabels[q] })),
        get: () => an().quality,
        set: (v) => updA((a) => (a.quality = v)),
      }),
    );
    const dither = add(
      selectControl({
        label: 'Dithering',
        options: [
          { value: 'floyd', label: 'Floyd–Steinberg' },
          { value: 'ordered', label: 'Ordered (Bayer)' },
          { value: 'none', label: 'None' },
        ],
        get: () => an().dither,
        set: (v) => updA((a) => (a.dither = v === 'ordered' || v === 'none' ? v : 'floyd')),
      }),
    );
    const palette = add(
      segmentedControl<AnimationSettings['palette']>({
        label: 'Color palette',
        options: [
          { value: 'global', label: 'Global' },
          { value: 'frame', label: 'Per frame' },
        ],
        get: () => an().palette,
        set: (v) => updA((a) => (a.palette = v)),
      }),
    );
    const paletteNote = h('p', {
      class: 'ctl-note',
      text: 'Global palette: stable colors and a smaller file. Per frame: more accurate colors and a larger file.',
    });
    const background = add(
      segmentedControl<AnimationSettings['background']>({
        label: 'Background',
        options: [
          { value: 'transparent', label: 'Transparent', title: 'Transparent (checkerboard)' },
          { value: 'scene', label: 'As preview' },
        ],
        get: () => an().background,
        set: (v) => updA((a) => (a.background = v)),
      }),
    );
    const gifAlphaNote = h('p', {
      class: 'ctl-note warn-note',
      text: `GIF only has 1-bit transparency: the soft shadow and reflection disappear and edges may look jagged. ${support.webp ? 'Choose the preview background or WebP.' : 'Choose the preview background.'}`,
    });
    const mp4AlphaNote = h('p', {
      class: 'ctl-note warn-note',
      text: 'MP4 has no transparency: the background will be white.',
    });
    add({
      el: quality.el,
      sync: () => {
        const a = an();
        const gif = a.format === 'gif';
        quality.el.hidden = gif;
        dither.el.hidden = !gif;
        palette.el.hidden = !gif;
        paletteNote.hidden = !gif;
        const transparent = a.background === 'transparent' || ctx.store.state.scene.background.mode === 'transparent';
        gifAlphaNote.hidden = !(gif && transparent);
        mp4AlphaNote.hidden = !(a.format === 'mp4' && transparent);
      },
    });
    const formatSection = section('export.anim.format', 'Format & background', [
      format.el,
      ...unsupportedNotes,
      quality.el,
      dither.el,
      palette.el,
      paletteNote,
      background.el,
      gifAlphaNote,
      mp4AlphaNote,
    ]);

    /* Summary + button --------------------------------------------- */
    const summary = h('div', { class: 'export-summary' });
    add({
      el: summary,
      sync: () => {
        const a = an();
        const o = outputSizeOf(a);
        summary.textContent = `${o.width} × ${o.height} px · ${FORMAT_LABEL[a.format]} · ${formatNumber(a.duration, a.duration % 1 ? 1 : 0)} s · Frames: ${frameCountOf(a)}`;
      },
    });
    animBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-large export-btn',
        title: 'Export animation…',
        attrs: { type: 'button' },
        on: { click: () => void ctx.actions.exportAnimation() },
      },
      h('span', { class: 'spinner small' }),
      h('span', { class: 'btn-icon', html: ICONS.exportImg }),
      h('span', { class: 'btn-text', text: 'Export animation…' }),
    );
    const footer = h('div', { class: 'export-footer' }, summary, animBtn);
    return [motionSection, sizeSection, formatSection, footer];
  };

  /* ================================================================ */
  /* Progress (animation)                                              */
  /* ================================================================ */

  const progressText = h('div', { class: 'anim-progress-text', attrs: { 'aria-live': 'polite' } });
  const progressBar = h('div', { class: 'anim-progress-bar' });
  const progressTrack = h(
    'div',
    {
      class: 'anim-progress-track',
      attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
    },
    progressBar,
  );
  const cancelBtn = h('button', {
    class: 'btn anim-cancel',
    text: 'Cancel',
    attrs: { type: 'button' },
    on: { click: () => ctx.actions.cancelAnimation() },
  });
  const progressEl = h(
    'div',
    { class: 'anim-progress', attrs: { hidden: true } },
    progressText,
    progressTrack,
    cancelBtn,
  );

  const updateProgress = (p: AnimationProgress | null) => {
    progressEl.hidden = !p;
    if (!p) return;
    let frac = 0;
    let text: string;
    switch (p.phase) {
      case 'palette':
        text = `Analyzing colors: ${p.done} / ${p.total}`;
        frac = p.total ? (0.1 * p.done) / p.total : 0;
        break;
      case 'frames':
        text = `Frames rendered & encoded: ${p.done} / ${p.total}`;
        frac = 0.1 + (p.total ? (0.85 * p.done) / p.total : 0);
        break;
      case 'finalize':
        text = 'Finishing the file…';
        frac = p.done ? 1 : 0.95;
        break;
      default:
        text = 'Preparing…';
    }
    const pct = Math.round(clamp(frac, 0, 1) * 100);
    progressText.textContent = text;
    progressBar.style.width = `${pct}%`;
    progressTrack.setAttribute('aria-valuenow', String(pct));
    progressTrack.setAttribute('aria-valuetext', text);
  };

  /* ================================================================ */

  const render = () => {
    el.replaceChildren();
    controls = [];
    exportBtn = null;
    animBtn = null;
    batchBtn = null;
    const add = <T extends Control>(c: T): T => {
      controls.push(c);
      return c;
    };

    const modeCtl = segmentedControl<Mode>({
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

    cancelBtn.textContent = 'Cancel';
    const parts = mode === 'animation' ? renderAnimation(add) : renderImage(add);
    el.append(modeCtl.el, ...parts, progressEl);
    updateBusy(ctx.exportBusy.value);
    updateProgress(ctx.animationProgress.value);
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
      if (mode === 'animation' && an().format !== renderedFormat) render();
      syncAll();
    }
  });
  ctx.exportBusy.subscribe(updateBusy);
  ctx.animationProgress.subscribe((p) => {
    updateProgress(p);
    updateBusy(ctx.exportBusy.value);
  });
  render();
  syncAll();
  return { el };
}
