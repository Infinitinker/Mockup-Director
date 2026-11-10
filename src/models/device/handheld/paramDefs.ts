/** The parameters of a phone or a tablet, made from its spec. */
import type { ParamDef } from '../../../core/types/model';
import { mmParam } from '../../params';
import { type DeviceSpec, FINISHES } from './spec';

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_SCREEN = 'Screen';
const G_DET = 'Details';

export function makeParams(spec: DeviceSpec): ParamDef[] {
  const out: ParamDef[] = [
    mmParam('width', 'Width', spec.width.def, spec.width.min, spec.width.max, spec.width.step, G_DIM),
    mmParam('height', 'Height', spec.height.def, spec.height.min, spec.height.max, spec.height.step, G_DIM),
    mmParam(
      'thickness',
      'Thickness',
      spec.thickness.def,
      spec.thickness.min,
      spec.thickness.max,
      spec.thickness.step,
      G_DIM,
    ),
    mmParam('bezel', 'Screen bezel', spec.bezel.def, spec.bezel.min, spec.bezel.max, spec.bezel.step, G_DIM),
    mmParam(
      'cornerRadius',
      'Corner radius',
      spec.radius.def,
      spec.radius.min,
      spec.radius.max,
      spec.radius.step,
      G_DIM,
    ),
    {
      id: 'orientation',
      type: 'select',
      label: 'Orientation',
      group: G_DIM,
      options: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
      default: spec.defaultOrientation,
    },
    {
      id: 'frame',
      type: 'select',
      label: 'Body finish',
      group: G_MAT,
      options: Object.entries(FINISHES).map(([value, f]) => ({ value, label: f.label })),
      default: spec.defaultFrame,
    },
    {
      id: 'frameColor',
      type: 'color',
      label: 'Custom body color',
      group: G_MAT,
      default: '#7a7f88',
    },
    {
      id: 'brightness',
      type: 'number',
      label: 'Screen brightness',
      group: G_SCREEN,
      min: 0,
      max: 150,
      step: 1,
      default: 90,
      unit: '%',
    },
    {
      id: 'screenFinish',
      type: 'select',
      label: 'Screen glass',
      group: G_SCREEN,
      options: [
        { value: 'glossy', label: 'Glossy' },
        { value: 'matte', label: 'Matte (anti-glare)' },
      ],
      default: 'glossy',
    },
    {
      id: 'frontCamera',
      type: 'select',
      label: 'Front camera',
      group: G_DET,
      options: [
        { value: 'none', label: 'None' },
        {
          value: 'punch',
          label: spec.kind === 'phone' ? 'Punch-hole' : 'Camera in the bezel',
        },
      ],
      default: 'punch',
    },
    {
      id: 'rearCamera',
      type: 'boolean',
      label: 'Rear camera',
      group: G_DET,
      default: true,
    },
    {
      id: 'buttons',
      type: 'boolean',
      label: 'Side buttons',
      group: G_DET,
      default: true,
    },
  ];
  if (spec.kind === 'tablet') {
    out.push({
      id: 'stylus',
      type: 'boolean',
      label: 'Stylus next to it',
      group: G_DET,
      default: false,
    });
  }
  return out;
}
