/**
 * The hardcover ('book-hardcover') and the paperback ('book-paperback'): their definitions and the
 * artwork slots, parameters and camera they share, set by their kind. Slots 'cover' (the wrap),
 * 'front', 'spine' and 'back'.
 */
import type { ImageSlotDef, ModelDefinition, ParamDef } from '../../core/types/model';
import { round1 } from '../../core/math';
import { icon } from '../icon';
import { mmParam } from '../params';
import { buildBook } from './build';
import { BOOK_DEFAULTS, type BookKind, wrapLayout } from './cover';
import { finishParam, G_MAT } from './finish';
import { BLEED, bookPanelTemplate, bookWrapTemplate } from './templates';

const G_DIM = 'Dimensions';
const G_ART = 'Artwork';

function bookSlots(kind: BookKind): ImageSlotDef[] {
  const w = wrapLayout({}, kind);
  const hc = w.g.Hc;
  const fw = w.L - w.s1;
  const sp = w.s1 - w.s0;
  const bw = w.s0;
  const aspect = (x: number) => (x + 2 * BLEED) / (hc + 2 * BLEED);
  const hard = kind === 'hard';
  const onlyIfNoCover = 'Used only when “Cover wrap” has no artwork.';
  // Appended to the wrap hint of the hardcover only (it starts with a space).
  const hardNote = hard
    ? ' The wrap covers the overhanging boards and the hinge grooves (marked on the template). Printers usually need a 15–20 mm turn-in for real case binding: this template matches the mockup, with a 3 mm bleed.'
    : '';
  const h = round1(hc);
  return [
    {
      id: 'cover',
      label: 'Cover wrap',
      hint:
        `The whole cover, left to right: Back | Spine | Front. By default ${round1(w.L)} × ${h} mm + 3 mm bleed ` +
        `(the ${round1(sp)} mm spine changes with the page block thickness; download the template). ` +
        `It takes priority over the separate Front / Spine / Back slots.${hardNote}`,
      aspect: aspect(w.L),
      template: (params) => bookWrapTemplate(params, kind),
    },
    {
      id: 'front',
      label: 'Front',
      hint: `${onlyIfNoCover} By default ${round1(fw)} × ${h} mm + 3 mm bleed (the left edge is at the spine).`,
      aspect: aspect(fw),
      template: (params) => bookPanelTemplate(params, kind, 'front'),
    },
    {
      id: 'spine',
      label: 'Spine',
      hint:
        `${onlyIfNoCover} A vertical strip: by default ${round1(sp)} × ${h} mm + 3 mm bleed (the left edge is on the back cover side). ` +
        'Without artwork the spine uses “Spine & back color (no artwork)”.',
      aspect: aspect(sp),
      template: (params) => bookPanelTemplate(params, kind, 'spine'),
    },
    {
      id: 'back',
      label: 'Back',
      hint: `${onlyIfNoCover} By default ${round1(bw)} × ${h} mm + 3 mm bleed (the right edge is at the spine). Without artwork the back uses “Spine & back color (no artwork)”.`,
      aspect: aspect(bw),
      template: (params) => bookPanelTemplate(params, kind, 'back'),
    },
  ];
}

function bookParams(kind: BookKind): ParamDef[] {
  const d = BOOK_DEFAULTS[kind];
  const hard = kind === 'hard';
  const out: ParamDef[] = [
    mmParam('width', 'Width (page block)', d.w, 60, 450, 1, G_DIM),
    mmParam('height', 'Height (page block)', d.h, 80, 600, 1, G_DIM),
    mmParam('thickness', 'Page block thickness', d.t, 2, hard ? 120 : 90, 0.5, G_DIM),
  ];
  if (hard) {
    out.push(
      mmParam('boardThickness', 'Board thickness', 2.5, 1.5, 4, 0.1, G_DIM),
      mmParam('squares', 'Cover overhang (squares)', 3, 1, 6, 0.5, G_DIM),
      {
        id: 'spine',
        type: 'select',
        label: 'Spine',
        group: G_DIM,
        options: [
          { value: 'rounded', label: 'Rounded' },
          { value: 'flat', label: 'Flat (square)' },
        ],
        default: 'rounded',
      },
    );
  } else {
    out.push({
      id: 'hingeScore',
      type: 'boolean',
      label: 'Hinge score lines',
      group: G_DIM,
      default: false,
    });
  }
  out.push(finishParam(hard ? 'matte' : 'gloss'), {
    id: 'pageColor',
    type: 'color',
    label: 'Page color',
    group: G_MAT,
    default: hard ? '#f3ecdc' : '#f1ead8',
  });
  if (hard) {
    out.push(
      { id: 'headband', type: 'boolean', label: 'Headband', group: G_MAT, default: true },
      { id: 'headbandColor', type: 'color', label: 'Headband color', group: G_MAT, default: '#8a1c22' },
    );
  }
  out.push({
    id: 'sideColor',
    type: 'color',
    label: 'Spine & back color (no artwork)',
    group: G_ART,
    default: hard ? '#2c3445' : '#ece9e2',
  });
  return out;
}

const ICON_HARDCOVER = icon(
  '<path d="M17 6h31a3 3 0 0 1 3 3v46a3 3 0 0 1-3 3H17"/>' +
    '<path d="M17 6c-4.5 0-7 2.5-7 6v40c0 3.5 2.5 6 7 6"/><path d="M17 6v52"/><path d="M22.5 6v52"/>' +
    '<path d="M29 20h15M29 26h10"/>',
);

const ICON_PAPERBACK = icon(
  '<rect x="15" y="7" width="35" height="50" rx="1.5"/><path d="M15 7c-2.5 0-4 1.5-4 3.5v43c0 2 1.5 3.5 4 3.5"/>' +
    '<path d="M24 20h18M24 26h12"/>',
);

/** Front-left 3/4 view: the spine sits on the left (-X) side. */
const BOOK_CAMERA = { yaw: -32, pitch: 12 };

export const hardcoverModel: ModelDefinition = {
  id: 'book-hardcover',
  category: 'book',
  name: 'Hardcover book',
  description:
    'Case-bound hardcover (2.5 mm boards) with overhanging covers, hinge grooves, a flat or rounded spine and a page block.',
  icon: ICON_HARDCOVER,
  slots: bookSlots('hard'),
  params: bookParams('hard'),
  defaultCamera: BOOK_CAMERA,
  build: (ctx) => buildBook(ctx, 'hard'),
};

export const paperbackModel: ModelDefinition = {
  id: 'book-paperback',
  category: 'book',
  name: 'Paperback book',
  description: 'Perfect-bound paperback: a thin cover flush with the page block and slightly rounded spine edges.',
  icon: ICON_PAPERBACK,
  slots: bookSlots('soft'),
  params: bookParams('soft'),
  defaultCamera: BOOK_CAMERA,
  build: (ctx) => buildBook(ctx, 'soft'),
};
