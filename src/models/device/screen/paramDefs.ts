/** The parameters the screenshot panel and the browser window share: size, shape, lean and finish. */
import type { ParamDef } from '../../../core/types/model';

const G_DIM = 'Dimensions';
const G_SHAPE = 'Shape & placement';
export const G_MAT = 'Material';

export function widthParam(def: number): ParamDef {
  return {
    id: 'width',
    type: 'number',
    label: 'Panel width',
    group: G_DIM,
    min: 40,
    max: 2000,
    step: 1,
    default: def,
    unit: 'mm',
  };
}

export function commonParams(defRadius: number): ParamDef[] {
  return [
    {
      id: 'thickness',
      type: 'number',
      label: 'Thickness',
      group: G_DIM,
      min: 0.5,
      max: 10,
      step: 0.1,
      default: 2,
      unit: 'mm',
    },
    {
      id: 'cornerRadius',
      type: 'number',
      label: 'Corner radius',
      group: G_DIM,
      min: 0,
      max: 60,
      step: 0.5,
      default: defRadius,
      unit: 'mm',
    },
    {
      id: 'curvature',
      type: 'number',
      label: 'Curvature (− convex, + concave)',
      group: G_SHAPE,
      min: -100,
      max: 100,
      step: 1,
      default: 0,
      unit: '%',
    },
    {
      id: 'tilt',
      type: 'number',
      label: 'Lean back',
      group: G_SHAPE,
      min: 0,
      max: 75,
      step: 1,
      default: 0,
      unit: 'deg',
    },
  ];
}

export function finishParams(): ParamDef[] {
  return [
    {
      id: 'finish',
      type: 'select',
      label: 'Finish',
      group: G_MAT,
      options: [
        { value: 'screen', label: 'Glossy screen (lit)' },
        { value: 'screenMatte', label: 'Matte screen (lit)' },
        { value: 'printMatte', label: 'Matte print' },
        { value: 'printGloss', label: 'Glossy print' },
      ],
      default: 'screen',
    },
    {
      id: 'glow',
      type: 'number',
      label: 'Screen brightness',
      group: G_MAT,
      min: 0,
      max: 200,
      step: 5,
      default: 80,
      unit: '%',
    },
    {
      id: 'bodyFinish',
      type: 'select',
      label: 'Edges & back',
      group: G_MAT,
      options: [
        { value: 'plastic', label: 'Satin plastic' },
        { value: 'gloss', label: 'Glossy plastic' },
        { value: 'metal', label: 'Metal (aluminum)' },
      ],
      default: 'plastic',
    },
  ];
}
