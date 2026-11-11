/**
 * The DVD case and Blu-ray case models ('dvd-case', 'bluray-case'): their params, icons and camera.
 *
 * Param ids (stable – composites call buildKeepCase(ctx, variant) with the same ids):
 *   thickness ('14' | '9' | '7' for DVD, '12' | '11' | '7' for Blu-ray – mm as a string),
 *   cornerRadius (mm), plastic (select), coverFinish ('glossy' | 'satin' | 'matte'),
 *   sleeveGloss (0..100 %), sideColor ('#rrggbb'), bandColor + bandEmboss (Blu-ray only).
 * Slot ids: 'cover' (wrap: back | spine | front), 'front', 'spine', 'back'.
 */
import type { ModelDefinition, ParamDef } from '../../../core/types/model';
import { icon } from '../../icon';
import { buildKeepCase } from './build';
import { makeSlots } from './insert';
import { PLASTICS, SPECS, type KeepCaseVariant } from './specs';

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_ART = 'Artwork';

function makeParams(variant: KeepCaseVariant): ParamDef[] {
  const spec = SPECS[variant];
  const out: ParamDef[] = [
    {
      id: 'thickness',
      type: 'select',
      label: 'Case thickness',
      group: G_DIM,
      options: spec.thicknessOptions,
      default: spec.defaultThickness,
    },
    {
      id: 'cornerRadius',
      type: 'number',
      label: 'Corner radius',
      group: G_DIM,
      min: 2.5,
      max: 4.5,
      step: 0.1,
      default: 3,
      unit: 'mm',
    },
    {
      id: 'plastic',
      type: 'select',
      label: 'Plastic color',
      group: G_MAT,
      options: Object.entries(PLASTICS).map(([value, d]) => ({ value, label: d.label })),
      default: spec.defaultPlastic,
    },
  ];
  if (spec.band) {
    out.push(
      {
        id: 'bandColor',
        type: 'color',
        label: 'Top band color',
        group: G_MAT,
        default: '#1d62cc',
      },
      {
        id: 'bandEmboss',
        type: 'boolean',
        label: 'Embossed band panel',
        group: G_MAT,
        default: true,
      },
    );
  }
  out.push(
    {
      id: 'coverFinish',
      type: 'select',
      label: 'Insert paper',
      group: G_MAT,
      options: [
        { value: 'glossy', label: 'Glossy' },
        { value: 'satin', label: 'Satin' },
        { value: 'matte', label: 'Matte' },
      ],
      default: 'satin',
    },
    {
      id: 'sleeveGloss',
      type: 'number',
      label: 'Sleeve film gloss',
      group: G_MAT,
      min: 0,
      max: 100,
      step: 1,
      default: 85,
      unit: '%',
    },
    {
      id: 'sideColor',
      type: 'color',
      label: 'Spine & back color (no artwork)',
      group: G_ART,
      default: '#1c1c1f',
    },
  );
  return out;
}

const ICON_DVD = icon(
  '<rect x="14" y="5" width="37" height="54" rx="4"/><path d="M21 5v54"/>' +
    '<circle cx="36" cy="32" r="8.5"/><circle cx="36" cy="32" r="2"/>',
);

const ICON_BLURAY = icon(
  '<rect x="14" y="8" width="37" height="49" rx="4"/><path d="M14 19h37"/><path d="M21 19v38"/><path d="M28 13.5h14"/>' +
    '<circle cx="36" cy="38" r="8"/><circle cx="36" cy="38" r="2"/>',
);

/** Front-left 3/4 view: the printed spine sits on the case's left (-X) side. */
const KEEPCASE_CAMERA = { yaw: -30, pitch: 12 };

export const dvdModel: ModelDefinition = {
  id: 'dvd-case',
  category: 'disc',
  name: 'DVD case',
  description: 'DVD keep case 190 × 135 mm (14 / 9 / 7 mm) with a printed insert under a clear sleeve.',
  icon: ICON_DVD,
  slots: makeSlots('dvd'),
  params: makeParams('dvd'),
  defaultCamera: KEEPCASE_CAMERA,
  build: (ctx) => buildKeepCase(ctx, 'dvd'),
};

export const blurayModel: ModelDefinition = {
  id: 'bluray-case',
  category: 'disc',
  name: 'Blu-ray case',
  description:
    'Blu-ray keep case 171.5 × 135 mm (12 / 11 / 7 mm) with a translucent top band and a printed insert under a clear sleeve.',
  icon: ICON_BLURAY,
  slots: makeSlots('bluray'),
  params: makeParams('bluray'),
  defaultCamera: KEEPCASE_CAMERA,
  build: (ctx) => buildKeepCase(ctx, 'bluray'),
};
