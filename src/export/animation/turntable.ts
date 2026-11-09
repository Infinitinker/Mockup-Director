/**
 * Turntable motion: product rotation angle per frame and per-frame delays.
 *
 * Angles are PRODUCT rotations in degrees around the vertical axis (+ = counter-clockwise seen
 * from above), relative to the current view – frame 0 is always exactly the current view.
 *  - loop:  constant speed, one full turn; frame N would equal frame 0, so it is left out and the
 *           animation loops seamlessly.
 *  - swing: back and forth between -A and +A. 'sine' easing = A * sin(2 pi t), i.e. an ease-in-out
 *           sine between the turning points (slow at +-A, fastest through the start view);
 *           'linear' is a triangle wave. Both start at the current view and loop seamlessly.
 */
import type { AnimationSettings } from '../../core/types';
import { frameCountOf } from './settings';

export function turntableAngles(
  s: Pick<AnimationSettings, 'fps' | 'duration' | 'motion' | 'swingAngle' | 'direction' | 'easing'>,
): number[] {
  const n = frameCountOf(s);
  // Clockwise seen from above = negative rotation about +Y (the front turns to the viewer's left).
  const sign = s.direction === 'cw' ? -1 : 1;
  const out: number[] = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const t = k / n;
    let a: number;
    if (s.motion === 'loop') {
      a = 360 * t;
    } else if (s.easing === 'linear') {
      // Triangle wave 0 -> +1 -> 0 -> -1 -> 0.
      const u = (t + 0.25) % 1;
      a = s.swingAngle * (u < 0.5 ? 4 * u - 1 : 3 - 4 * u);
    } else {
      a = s.swingAngle * Math.sin(2 * Math.PI * t);
    }
    out[k] = sign * a + 0; // + 0 turns -0 into 0
  }
  return out;
}

/**
 * Per-frame delays in integer `unitsPerSecond` (100 = GIF centiseconds, 1000 = WebP milliseconds).
 * Rounding errors are carried over, so the total length stays exact (e.g. 30 fps GIF: 3,4,3,3,4,3 ...).
 */
export function frameDelays(count: number, fps: number, unitsPerSecond: number): number[] {
  const out: number[] = [];
  const step = unitsPerSecond / Math.max(1, fps);
  for (let k = 0; k < count; k++) out.push(Math.max(1, Math.round((k + 1) * step) - Math.round(k * step)));
  return out;
}
