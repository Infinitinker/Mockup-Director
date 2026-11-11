/** The smartphone model: its spec and its definition. */
import type { ModelDefinition } from '../../../core/types/model';
import { icon } from '../../icon';
import { buildDevice } from './build';
import { makeParams } from './paramDefs';
import { makeSlot } from './slot';
import { DEVICE_CAMERA, type DeviceSpec } from './spec';

const PHONE_SPEC: DeviceSpec = {
  kind: 'phone',
  width: { def: 71.5, min: 55, max: 90, step: 0.5 },
  height: { def: 147, min: 110, max: 180, step: 0.5 },
  thickness: { def: 8, min: 5, max: 12, step: 0.1 },
  bezel: { def: 1.8, min: 1.3, max: 8, step: 0.1 },
  radius: { def: 9, min: 3, max: 20, step: 0.5 },
  defaultOrientation: 'portrait',
  glassT: 0.95,
  glassEdge: 0.75,
  backGlassT: 0.95,
  ppi: 460,
  camR: 1.6,
  camEdge: 'top',
  rear: {
    w: 21,
    h: 32,
    r: 7,
    margin: 7,
    bump: 1.4,
    lensR: 5.3,
    lenses: [
      [0, 7.8],
      [0, -7.8],
    ],
    // Outside the module, beside the upper lens (toward the body center).
    flash: [-15, 7.8],
    flashR: 1.5,
  },
  defaultFrame: 'graphite',
};

const ICON_PHONE = icon(
  '<rect x="18" y="5" width="28" height="54" rx="6"/><circle cx="32" cy="11.5" r="1.4" fill="currentColor" stroke="none"/>' +
    '<path d="M27 53h10"/>',
);

export const phoneModel: ModelDefinition = {
  id: 'device-phone',
  category: 'device',
  name: 'Smartphone',
  description: 'Generic smartphone 71.5 × 147 × 8 mm with a lit screen, punch-hole camera and rear camera module.',
  icon: ICON_PHONE,
  slots: [makeSlot(PHONE_SPEC)],
  params: makeParams(PHONE_SPEC),
  defaultCamera: DEVICE_CAMERA,
  build: (ctx) => buildDevice(ctx, PHONE_SPEC),
};
