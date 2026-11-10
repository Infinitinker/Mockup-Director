/**
 * The resolved dimensions of a phone or a tablet from its parameters, shared by the build and the
 * screen slot, and the screen's size in the chosen orientation.
 */
import type { ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { num, str } from '../../params';
import { type DeviceSpec, GLASS_INSET } from './spec';

export interface Dims {
  W: number;
  H: number;
  T: number;
  /** Body corner radius (front view). */
  r: number;
  bezel: number;
  /** Screen size in the PORTRAIT local frame and its corner radius. */
  sw: number;
  sh: number;
  sr: number;
  landscape: boolean;
  /** Front camera in the local frame (null = none); inScreen = punch-hole through the screen. */
  cam: { x: number; y: number; r: number; inScreen: boolean } | null;
}

export function resolveDims(spec: DeviceSpec, p: ParamValues): Dims {
  const W = clamp(num(p, 'width', spec.width.def), spec.width.min, spec.width.max);
  const H = clamp(num(p, 'height', spec.height.def), spec.height.min, spec.height.max);
  const T = clamp(num(p, 'thickness', spec.thickness.def), spec.thickness.min, spec.thickness.max);
  const flatInset = GLASS_INSET + spec.glassEdge; // where the flat glass top starts
  const r = clamp(num(p, 'cornerRadius', spec.radius.def), flatInset + 0.6, Math.min(W, H) / 2 - 1);
  // The screen must lie on the flat part of the glass and leave a usable area.
  const bezel = clamp(num(p, 'bezel', spec.bezel.def), flatInset + 0.2, Math.min(W, H) / 2 - 10);
  const sw = W - 2 * bezel;
  const sh = H - 2 * bezel;
  const sr = Math.max(0.4, r - bezel);
  const landscape = str(p, 'orientation', spec.defaultOrientation) === 'landscape';

  let cam: Dims['cam'] = null;
  if (str(p, 'frontCamera', 'punch') === 'punch') {
    const cr = spec.camR;
    // Wide bezel (tablets): the camera sits in the bezel, otherwise it punches through the screen.
    const inBezel = bezel >= 2 * cr + 2.4;
    const fromEdge = inBezel ? bezel / 2 : bezel + cr + 2.6;
    if (spec.camEdge === 'top') cam = { x: 0, y: H / 2 - fromEdge, r: cr, inScreen: !inBezel };
    else cam = { x: W / 2 - fromEdge, y: 0, r: cr, inScreen: !inBezel };
  }
  return { W, H, T, r, bezel, sw, sh, sr, landscape, cam };
}

/** Screen size as seen in the chosen orientation (width, height). */
export function orientedScreen(d: Dims): [number, number] {
  return d.landscape ? [d.sh, d.sw] : [d.sw, d.sh];
}
