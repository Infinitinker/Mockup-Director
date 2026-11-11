/** The tablet model: its spec and its definition. */
import type { ModelDefinition } from '../../../core/types/model';
import { icon } from '../../icon';
import { buildDevice } from './build';
import { makeParams } from './paramDefs';
import { makeSlot } from './slot';
import { DEVICE_CAMERA, type DeviceSpec } from './spec';

const TABLET_SPEC: DeviceSpec = {
  kind: 'tablet',
  width: { def: 179.5, min: 120, max: 240, step: 0.5 },
  height: { def: 247.6, min: 170, max: 320, step: 0.5 },
  thickness: { def: 6.3, min: 4.5, max: 10, step: 0.1 },
  bezel: { def: 8, min: 2, max: 20, step: 0.1 },
  radius: { def: 11, min: 4, max: 25, step: 0.5 },
  defaultOrientation: 'landscape',
  glassT: 0.8,
  glassEdge: 0.6,
  backGlassT: 0,
  ppi: 264,
  camR: 1.2,
  camEdge: 'right',
  rear: {
    w: 13,
    h: 23,
    r: 6,
    margin: 8,
    bump: 0.9,
    lensR: 3.8,
    lenses: [[0, 4.6]],
    flash: [0, -6.2],
    flashR: 1.4,
  },
  defaultFrame: 'silver',
};

const ICON_TABLET = icon(
  '<rect x="6" y="9" width="52" height="38" rx="5"/><rect x="11.5" y="14.5" width="41" height="27" rx="1.5"/>' +
    '<path d="M12 56h33"/><path d="M45 54l6 2-6 2"/>',
);

export const tabletModel: ModelDefinition = {
  id: 'device-tablet',
  category: 'device',
  name: 'Tablet',
  description: 'Generic tablet 179.5 × 247.6 × 6.3 mm (landscape by default) with a lit screen and an optional stylus.',
  icon: ICON_TABLET,
  slots: [makeSlot(TABLET_SPEC)],
  params: makeParams(TABLET_SPEC),
  defaultCamera: DEVICE_CAMERA,
  build: (ctx) => buildDevice(ctx, TABLET_SPEC),
};
