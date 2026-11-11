/**
 * Tests the resolved dimensions of the phone and the tablet in src/models/device/handheld/dims.ts:
 * the screen inside the bezel, the clamped corner radius and bezel, the front camera in the screen
 * or in the bezel, and the screen in the chosen orientation.
 */
import { describe, expect, it } from 'vitest';
import { orientedScreen, resolveDims } from '../../../../src/models/device/handheld/dims';
import type { DeviceSpec } from '../../../../src/models/device/handheld/spec';

/** A phone-like spec: a thin bezel and the camera on the top edge. */
const PHONE: DeviceSpec = {
  kind: 'phone',
  width: { def: 70, min: 55, max: 90, step: 0.5 },
  height: { def: 150, min: 110, max: 180, step: 0.5 },
  thickness: { def: 8, min: 5, max: 12, step: 0.1 },
  bezel: { def: 2, min: 1.3, max: 8, step: 0.1 },
  radius: { def: 9, min: 3, max: 20, step: 0.5 },
  defaultOrientation: 'portrait',
  glassT: 0.95,
  glassEdge: 0.75,
  backGlassT: 0.95,
  ppi: 460,
  camR: 1.6,
  camEdge: 'top',
  rear: { w: 20, h: 30, r: 6, margin: 7, bump: 1, lensR: 5, lenses: [[0, 0]], flash: [0, -10], flashR: 1.5 },
  defaultFrame: 'graphite',
};

/** A tablet-like spec: a wide bezel and the camera on the right edge. */
const TABLET: DeviceSpec = {
  ...PHONE,
  kind: 'tablet',
  width: { def: 180, min: 120, max: 240, step: 0.5 },
  height: { def: 250, min: 170, max: 320, step: 0.5 },
  bezel: { def: 8, min: 2, max: 20, step: 0.1 },
  defaultOrientation: 'landscape',
  camR: 1.2,
  camEdge: 'right',
};

describe('resolveDims', () => {
  it('puts the screen inside the bezel and a punch-hole camera through it on a thin bezel', () => {
    const d = resolveDims(PHONE, {});
    expect(d).toMatchObject({ W: 70, H: 150, T: 8, r: 9, bezel: 2, sw: 66, sh: 146, sr: 7, landscape: false });
    expect(d.cam).toEqual({ x: 0, y: 75 - (2 + 1.6 + 2.6), r: 1.6, inScreen: true });
  });

  it('puts the camera in a wide bezel, on the edge the spec names', () => {
    const d = resolveDims(TABLET, {});
    expect(d.landscape).toBe(true);
    expect(d.cam).toEqual({ x: 90 - 4, y: 0, r: 1.2, inScreen: false });
  });

  it('clamps the size to the spec and the corner radius and bezel to what the glass allows', () => {
    const small = resolveDims(PHONE, { width: 1, height: 1000, cornerRadius: 0, bezel: 0 });
    expect([small.W, small.H]).toEqual([55, 180]);
    expect(small.r).toBeCloseTo(0.3 + 0.75 + 0.6, 10);
    expect(small.bezel).toBeCloseTo(0.3 + 0.75 + 0.2, 10);
    const large = resolveDims(PHONE, { cornerRadius: 99, bezel: 99 });
    expect(large.r).toBe(34);
    expect(large.bezel).toBe(25);
    expect(large.sr).toBe(9);
  });

  it('leaves the camera out and follows the chosen orientation', () => {
    const d = resolveDims(PHONE, { frontCamera: 'none', orientation: 'landscape' });
    expect(d.cam).toBeNull();
    expect(d.landscape).toBe(true);
  });
});

describe('orientedScreen', () => {
  it('swaps the screen size in landscape', () => {
    expect(orientedScreen(resolveDims(PHONE, {}))).toEqual([66, 146]);
    expect(orientedScreen(resolveDims(PHONE, { orientation: 'landscape' }))).toEqual([146, 66]);
  });
});
