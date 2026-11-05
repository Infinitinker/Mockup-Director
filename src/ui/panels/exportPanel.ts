/**
 * "Eksport" tab: output size, margin, sizing mode, format, quality and background.
 */
import type { ExportFormat, ExportSettings } from '../../core/types';
import { MAX_EXPORT_SIZE } from '../../core/defaults';
import type { AppContext } from '../context';
import { t } from '../i18n';
import { clamp, h, nextId, safeStorage, shortcutLabel } from '../dom';
import { ICONS } from '../icons';
import { numberControl, section, segmentedControl, type Control } from '../controls';
import { hasAny } from '../state';
import { webpEncodingSupported } from '../exportBridge';

const SIZE_PRESETS = [800, 1200, 1600, 2000, 3000, 4000];
const MIN_SIZE = 16;
const LOCK_KEY = 'mockup-director.ui.lockAspect';

export function createExportPanel(ctx: AppContext): { el: HTMLElement; render(): void } {
  const el = h('div', { class: 'panel panel-export' });
  let controls: Control[] = [];
  let lockAspect = safeStorage.get(LOCK_KEY) !== '0';
  let exportBtn: HTMLButtonElement | null = null;

  const ex = () => ctx.store.state.export;
  const upd = (fn: (e: ExportSettings) => void) => ctx.store.update(['export'], (s) => fn(s.export));

  const setSize = (w: number, h2: number) =>
    upd((e) => {
      e.width = Math.round(clamp(w, MIN_SIZE, MAX_EXPORT_SIZE));
      e.height = Math.round(clamp(h2, MIN_SIZE, MAX_EXPORT_SIZE));
      e.margin = Math.min(e.margin, Math.floor(Math.min(e.width, e.height) / 2) - 1);
    });

  /** Width/height numeric field with lock-aspect behaviour. */
  const dimField = (which: 'width' | 'height'): Control => {
    const id = nextId('dim');
    const input = h('input', { class: 'num-input', attrs: { id, type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false' } });
    const el = h(
      'div',
      { class: 'dim-field' },
      h('label', { class: 'ctl-label', text: which === 'width' ? t('width') : t('height'), attrs: { for: id } }),
      h('span', { class: 'num-wrap' }, input, h('span', { class: 'unit', text: 'px' })),
    );
    const commit = () => {
      const n = Number(input.value.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        sync();
        return;
      }
      const e = ex();
      const v = clamp(Math.round(n), MIN_SIZE, MAX_EXPORT_SIZE);
      if (which === 'width') {
        let hh = e.height;
        if (lockAspect && e.width > 0) hh = (e.height / e.width) * v;
        // Keep the other side inside the limit too (scale both down proportionally).
        if (hh > MAX_EXPORT_SIZE) setSize((v * MAX_EXPORT_SIZE) / hh, MAX_EXPORT_SIZE);
        else setSize(v, hh);
      } else {
        let ww = e.width;
        if (lockAspect && e.height > 0) ww = (e.width / e.height) * v;
        if (ww > MAX_EXPORT_SIZE) setSize(MAX_EXPORT_SIZE, (v * MAX_EXPORT_SIZE) / ww);
        else setSize(ww, v);
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
        const cur = Number(input.value) || ex()[which];
        input.value = String(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 100 : 10));
        commit();
      }
    });
    const sync = () => {
      if (document.activeElement !== input) input.value = String(ex()[which]);
    };
    sync();
    return { el, sync };
  };

  const render = () => {
    el.replaceChildren();
    controls = [];
    const add = <T extends Control>(c: T): T => {
      controls.push(c);
      return c;
    };

    /* Size --------------------------------------------------------- */
    const chips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': t('sizePresets') } });
    const chipButtons = SIZE_PRESETS.map((n) => {
      const b = h('button', {
        class: 'chip',
        text: `${n}`,
        title: `${n} × ${n} px`,
        attrs: { type: 'button' },
        on: { click: () => setSize(n, n) },
      });
      chips.appendChild(b);
      return b;
    });
    add({
      el: chips,
      sync: () =>
        chipButtons.forEach((b, i) => {
          const on = ex().width === SIZE_PRESETS[i] && ex().height === SIZE_PRESETS[i];
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        }),
    });
    const wField = add(dimField('width'));
    const hField = add(dimField('height'));
    const lockBtn = h('button', {
      class: `btn btn-icon-only lock-btn${lockAspect ? ' active' : ''}`,
      html: lockAspect ? ICONS.lock : ICONS.unlock,
      title: t('lockAspect'),
      attrs: { type: 'button', 'aria-pressed': String(lockAspect), 'aria-label': t('lockAspect') },
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
    const dims = h('div', { class: 'dims' }, wField.el, h('span', { class: 'dims-x', text: '×' }), hField.el, lockBtn);
    const margin = add(
      numberControl({
        label: t('margin'),
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
        label: t('sizing'),
        options: [
          { value: 'canvas', label: t('sizingCanvas'), title: t('sizingCanvasHint') },
          { value: 'trim', label: t('sizingTrim'), title: t('sizingTrimHint') },
        ],
        get: () => ex().sizing,
        set: (v) => upd((e) => (e.sizing = v)),
      }),
    );
    const sizingNote = h('p', { class: 'ctl-note' });
    add({ el: sizingNote, sync: () => (sizingNote.textContent = ex().sizing === 'canvas' ? t('sizingCanvasHint') : t('sizingTrimHint')) });

    const sizeSection = section('export.size', t('size'), [
      h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', text: t('sizePresets') }), chips),
      dims,
      h('p', { class: 'ctl-note', text: t('maxSize', { n: MAX_EXPORT_SIZE }) }),
      margin.el,
      sizing.el,
      sizingNote,
    ]);

    /* Format ------------------------------------------------------- */
    const webp = webpEncodingSupported();
    const format = add(
      segmentedControl<ExportFormat>({
        label: t('format'),
        options: [
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'webp', label: 'WebP', disabled: !webp, title: webp ? 'WebP' : t('webpUnsupported') },
        ],
        get: () => ex().format,
        set: (v) => upd((e) => (e.format = v)),
      }),
    );
    const quality = add(
      numberControl({
        label: t('quality'),
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
        label: t('exportBackground'),
        options: [
          { value: 'transparent', label: t('bgTransparentShort'), title: t('bgTransparent') },
          { value: 'scene', label: t('bgAsPreview') },
        ],
        get: () => ex().background,
        set: (v) => upd((e) => (e.background = v)),
      }),
    );
    const jpegNote = h('p', { class: 'ctl-note warn-note', text: t('jpegNoAlpha') });
    add({ el: jpegNote, sync: () => (jpegNote.hidden = !(ex().format === 'jpeg' && ex().background === 'transparent')) });
    const formatSection = section('export.format', t('formatSection'), [
      format.el,
      !webp ? h('p', { class: 'ctl-note', text: t('webpUnsupported') }) : null,
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
        const fmt = e.format === 'jpeg' ? 'JPEG' : e.format.toUpperCase();
        const transparent = e.background === 'transparent' && e.format !== 'jpeg';
        const size = e.sizing === 'trim' ? t('summaryTrim', { w: e.width, h: e.height }) : `${e.width} × ${e.height} px`;
        summary.textContent = `${size} · ${fmt} · ${transparent ? t('summaryTransparent') : t('summaryOpaque')}`;
      },
    });
    exportBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-large export-btn',
        title: `${t('exportImageDots')} (${shortcutLabel('E')})`,
        attrs: { type: 'button' },
        on: { click: () => void ctx.actions.exportImage() },
      },
      h('span', { class: 'spinner small' }),
      h('span', { class: 'btn-icon', html: ICONS.exportImg }),
      h('span', { class: 'btn-text', text: t('exportImageDots') }),
    );
    const footer = h('div', { class: 'export-footer' }, summary, exportBtn);

    el.append(sizeSection, formatSection, footer);
    updateBusy(ctx.exportBusy.value);
  };

  const updateBusy = (busy: boolean) => {
    if (!exportBtn) return;
    exportBtn.disabled = busy;
    exportBtn.classList.toggle('busy', busy);
    const text = exportBtn.querySelector('.btn-text');
    if (text) text.textContent = busy ? t('exporting') : t('exportImageDots');
  };

  const syncAll = () => controls.forEach((c) => c.sync());
  ctx.store.subscribe((e) => {
    if (e.kinds.has('lang')) {
      render();
      syncAll();
    } else if (hasAny(e, 'export')) syncAll();
  });
  ctx.exportBusy.subscribe(updateBusy);
  render();
  syncAll();
  return { el, render };
}
