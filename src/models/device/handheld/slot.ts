/**
 * The screen slot of a phone or a tablet: its hint with the recommended pixel size, and its print
 * template with the punch-hole camera marked.
 */
import type { ImageSlotDef, ParamValues, PrintTemplate } from '../../../core/types/model';
import { round1 } from '../../../core/math';
import { type Dims, orientedScreen, resolveDims } from './dims';
import type { DeviceSpec } from './spec';

/**
 * Local (portrait) point -> template coordinates (mm from the oriented screen's top-left).
 * Landscape = local rotated +90° about Z: world (x, y) = (-y_local, x_local).
 */
function toTemplate(d: Dims, x: number, y: number): [number, number] {
  const [ow, oh] = orientedScreen(d);
  const wx = d.landscape ? -y : x;
  const wy = d.landscape ? x : y;
  return [wx + ow / 2, oh / 2 - wy];
}

function screenTemplate(spec: DeviceSpec, p: ParamValues): PrintTemplate {
  const d = resolveDims(spec, p);
  const [ow, oh] = orientedScreen(d);
  const regions = [{ xMm: 0, yMm: 0, wMm: ow, hMm: oh, label: 'Screen' }];
  if (d.cam?.inScreen) {
    const [cx, cy] = toTemplate(d, d.cam.x, d.cam.y);
    const s = d.cam.r * 2 + 1;
    regions.push({ xMm: cx - s / 2, yMm: cy - s / 2, wMm: s, hMm: s, label: 'Camera' });
  }
  // No bleed: a screen image is not printed, the template only shows the exact screen frame.
  return { widthMm: ow, heightMm: oh, regions };
}

export function makeSlot(spec: DeviceSpec): ImageSlotDef {
  const p: ParamValues = {};
  const d = resolveDims(spec, p);
  const [ow, oh] = orientedScreen(d);
  const px = (mm: number) => Math.round((mm / 25.4) * spec.ppi);
  const orientation = d.landscape ? 'landscape' : 'portrait';
  const otherOrientation = d.landscape ? 'portrait' : 'landscape';
  // A typical screenshot size of such a device, quoted in the hint.
  const [exampleW, exampleH] = spec.kind === 'phone' ? [1179, 2556] : [2388, 1668];
  return {
    id: 'screen',
    label: 'Screen',
    hint: `The artwork shown on the screen, such as a screenshot of an app or a website. Recommended size: ${px(ow)} × ${px(oh)} px ${orientation} (screen ${round1(ow)} × ${round1(oh)} mm); for ${otherOrientation}, swap the sizes. A typical screenshot (e.g. ${exampleW} × ${exampleH} px) fits too: it is cropped slightly. Other aspect ratios fill the screen with cropping, and the rounded corners clip it.`,
    aspect: ow / oh,
    fitsArtwork: true,
    template: (params) => screenTemplate(spec, params),
  };
}
