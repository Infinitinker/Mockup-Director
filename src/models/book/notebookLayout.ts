/**
 * A spiral notebook in numbers: its size, covers and corner radius from the parameters, and the
 * holes and wire of its binding (pitch, ring radius, hole positions).
 */
import type { ParamValues } from '../../core/types/model';
import { clamp } from '../../core/math';
import { num, str } from '../params';

type Binding = 'left' | 'top';
type CoilStyle = 'doubleLoop' | 'spiral';

export interface NoteGeom {
  W: number;
  H: number;
  P: number;
  tc: number;
  rc: number;
  binding: Binding;
  coil: CoilStyle;
  /** Distance from the outer cover surface to the middle of the book (= P/2 + cover). */
  Tf: number;
  /** Hole center distance from the binding edge. */
  hd: number;
  /** Hole size along the edge / across it. */
  holeAlong: number;
  holeAcross: number;
  /** Ring radius, wire radius, offset of the ring center from the hole toward the edge. */
  R: number;
  rw: number;
  sOff: number;
  pitch: number;
  /** Double loop wire: center distance of the two wires of a loop. */
  pairGap: number;
  /** Positions of the holes along the binding edge (centered on 0). */
  positions: number[];
}

const INCH = 25.4;

export function noteGeom(p: ParamValues): NoteGeom {
  const W = clamp(num(p, 'width', 148), 50, 600);
  const H = clamp(num(p, 'height', 210), 50, 800);
  const P = clamp(num(p, 'thickness', 10), 1, 50);
  const tc = clamp(num(p, 'coverThickness', 0.8), 0.15, 4);
  const rc = clamp(num(p, 'cornerRadius', 3), 0, Math.min(W, H) / 2 - 1);
  const binding: Binding = str(p, 'binding', 'left') === 'top' ? 'top' : 'left';
  const coil: CoilStyle = str(p, 'coil', 'doubleLoop') === 'spiral' ? 'spiral' : 'doubleLoop';
  const Tf = P / 2 + tc;
  const hd = 5;
  // The ring passes through the hole on the front and back surfaces and must clear the binding
  // edge (wrapping round it above the cover): its radius is at least 1.2 mm more than Tf, and its
  // center sits at least 1.2 mm nearer the edge than halfway between the hole and the edge.
  const R = Math.max(Tf + 1.2, Math.sqrt(Tf * Tf + (hd / 2 + 1.2) ** 2));
  const sOff = Math.sqrt(R * R - Tf * Tf);
  let pitch: number;
  let rw: number;
  let pairGap = 0;
  let holeAlong: number;
  let holeAcross: number;
  if (coil === 'doubleLoop') {
    // Double loop wire: 3:1 pitch up to 9/16" loops, 2:1 above.
    const small = 2 * R <= 14.3;
    pitch = small ? INCH / 3 : INCH / 2;
    rw = small ? 0.5 : 0.62;
    pairGap = small ? 2 : 2.7;
    holeAlong = pairGap + 2.8;
    holeAcross = small ? 3.2 : 3.8;
  } else {
    // Single coil: 5:1 pitch for small coils, 4:1 above; round holes.
    const small = 2 * R <= 12;
    pitch = small ? INCH / 5 : INCH / 4;
    rw = small ? 0.55 : 0.65;
    holeAlong = holeAcross = small ? 3.6 : 4.2;
  }
  const edgeLen = binding === 'left' ? H : W;
  const margin = Math.max(5, pitch * 0.6);
  const n = Math.max(2, Math.floor((edgeLen - 2 * margin) / pitch) + 1);
  const positions = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
  return { W, H, P, tc, rc, binding, coil, Tf, hd, holeAlong, holeAcross, R, rw, sOff, pitch, pairGap, positions };
}

/** The center of the hole at position `a` along the binding edge, as (x, y). */
export function holeCenter(g: NoteGeom, a: number): [number, number] {
  return g.binding === 'left' ? [-g.W / 2 + g.hd, a] : [a, g.H / 2 - g.hd];
}
