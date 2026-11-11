/**
 * The Image export type of the Export tab (a still): size, format and background, the summary, and the
 * Export image… and Batch export… buttons.
 */
import type { ExportFormat, ExportSettings } from '../../../core/types/export';
import { MAX_EXPORT_SIZE } from '../../../core/defaults';
import { clamp } from '../../../core/math';
import { IMAGE_FORMAT_LABEL, supportsWebpEncoding } from '../../../export/formats';
import { WEBP_IMAGE_UNSUPPORTED } from '../../../export/exporter';
import type { AppContext } from '../../context';
import type { AddControl } from '../../controls';
import { numberControl } from '../../controls/number';
import { section } from '../../controls/section';
import { segmentedControl } from '../../controls/segmented';
import { h, shortcutLabel } from '../../dom';
import { ICONS } from '../../icons';
import { stillOf, updateStill } from './settings';
import { sizeRows, type AspectLock, type DimTarget } from './size';

const SIZE_PRESETS = [800, 1200, 1600, 2000, 3000, 4000];

const SIZING_HINT: Record<ExportSettings['sizing'], string> = {
  canvas: 'The image has exactly the given size, with the object centered.',
  trim: 'The image is cropped to the object plus the margin: one side is usually smaller.',
};

/** The sections of the Image export type, and its two buttons (their busy state is the tab's). */
export function stillSections(
  ctx: AppContext,
  dims: DimTarget,
  lock: AspectLock,
  add: AddControl,
): { parts: HTMLElement[]; exportBtn: HTMLButtonElement; batchBtn: HTMLButtonElement } {
  const ex = () => stillOf(ctx);
  const upd = (fn: (e: ExportSettings) => void) => updateStill(ctx, fn);

  // Size
  const rows = sizeRows(SIZE_PRESETS, dims, lock, add);
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
    h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', text: 'Size presets (square)' }), rows.chips),
    rows.dims,
    h('p', { class: 'ctl-note', text: `The largest size is ${MAX_EXPORT_SIZE} × ${MAX_EXPORT_SIZE} px.` }),
    margin.el,
    sizing.el,
    sizingNote,
  ]);

  // Format
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

  // Summary and buttons
  const summary = h('div', { class: 'export-summary' });
  add({
    el: summary,
    sync: () => {
      const e = ex();
      const fmt = IMAGE_FORMAT_LABEL[e.format];
      const transparent = e.background === 'transparent' && e.format !== 'jpeg';
      const size = e.sizing === 'trim' ? `up to ${e.width} × ${e.height} px (trimmed)` : `${e.width} × ${e.height} px`;
      summary.textContent = `${size} · ${fmt} · ${transparent ? 'transparent background' : 'with background'}`;
    },
  });
  const exportBtn = h(
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
  const batchBtn = h(
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
  return { parts: [sizeSection, formatSection, footer], exportBtn, batchBtn };
}
