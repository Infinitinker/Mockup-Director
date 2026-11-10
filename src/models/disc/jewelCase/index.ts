/**
 * The CD jewel case model ('cd-case'): its booklet, inlay and disc slots and its params.
 *
 * Param ids (stable – composites call buildJewelCase(ctx) with them):
 *   variant 'standard' | 'slim', trayColor 'black' | 'clear' | 'white' | 'smoke',
 *   inlayColor '#rrggbb' (used when no inlay image), paperFinish 'matte' | 'satin' | 'gloss',
 *   showBooklet boolean, showDisc boolean, + discParams (discFinish, discInner, ...).
 * Slot ids: 'booklet' (primary), 'inlay', 'disc'.
 */
import type { ImageSlotDef, ModelDefinition, ParamDef } from '../../../core/types/model';
import { icon } from '../../icon';
import { discParams, discSlot } from '../label';
import { buildJewelCase } from './build';
import { BOOKLET_TEMPLATE, IH, INLAY_TEMPLATE, IW } from './layout';

const bookletSlot: ImageSlotDef = {
  id: 'booklet',
  label: 'Booklet (cover)',
  hint: 'The booklet front, 120 × 120 mm + 3 mm bleed (a 126 × 126 mm file). It shows under the clear lid.',
  aspect: 1,
  template: BOOKLET_TEMPLATE,
};

const inlaySlot: ImageSlotDef = {
  id: 'inlay',
  label: 'Back inlay (tray card)',
  hint: 'The tray card, 151 × 118 mm (spine 6.5 mm | back 138 mm | spine 6.5 mm) + 3 mm bleed (a 157 × 124 mm file). The template’s left spine ends up on the case’s right (opening) side, the right one on the hinge side. Slim cases show only the back, with a clear tray.',
  aspect: IW / IH,
  template: INLAY_TEMPLATE,
};

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_CONTENT = 'Contents';

const jewelCaseParams: ParamDef[] = [
  {
    id: 'variant',
    type: 'select',
    label: 'Case type',
    group: G_DIM,
    options: [
      { value: 'standard', label: 'Standard 10.4 mm' },
      { value: 'slim', label: 'Slim 5.2 mm' },
    ],
    default: 'standard',
  },
  {
    id: 'trayColor',
    type: 'select',
    label: 'Tray',
    group: G_MAT,
    options: [
      { value: 'black', label: 'Black' },
      { value: 'clear', label: 'Clear' },
      { value: 'white', label: 'White' },
      { value: 'smoke', label: 'Smoked' },
    ],
    default: 'black',
  },
  {
    id: 'inlayColor',
    type: 'color',
    label: 'Inlay color (no artwork)',
    group: G_MAT,
    default: '#ffffff',
  },
  {
    id: 'paperFinish',
    type: 'select',
    label: 'Paper finish',
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss' },
    ],
    default: 'satin',
  },
  { id: 'showBooklet', type: 'boolean', label: 'Booklet in the lid', group: G_CONTENT, default: true },
  { id: 'showDisc', type: 'boolean', label: 'Disc inside', group: G_CONTENT, default: false },
];

export const cdCaseModel: ModelDefinition = {
  id: 'cd-case',
  category: 'disc',
  name: 'CD jewel case',
  description: 'Classic CD jewel case 142 × 125 × 10.4 mm (or slim 5.2 mm) with booklet, back inlay and spines.',
  icon: icon(
    '<rect x="6" y="10" width="52" height="44" rx="2.5"/><path d="M12 10v44M15.5 14v36"/>' +
      '<rect x="20" y="14" width="34" height="36" rx="1"/><circle cx="37" cy="32" r="3"/>',
    2.5,
  ),
  slots: [
    bookletSlot,
    inlaySlot,
    {
      ...discSlot,
      hint: 'A 120 × 120 mm square. It is visible when “Disc inside” is on and “Booklet in the lid” is off.',
    },
  ],
  params: [...jewelCaseParams, ...discParams],
  defaultCamera: { yaw: 30, pitch: 10, fov: 24 },
  build: buildJewelCase,
};
