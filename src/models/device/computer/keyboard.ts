/** The laptop's generic keyboard: the key rows, and all key caps merged into one geometry. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rrSlab } from './slabs';

/** Key widths per row in key units (each row = 15 u); the bottom row adds 3 u of arrow keys. */
const KEY_ROWS: number[][] = [
  Array<number>(14).fill(15 / 14),
  [...Array<number>(13).fill(1), 2],
  [1.5, ...Array<number>(12).fill(1), 1.5],
  [1.75, ...Array<number>(11).fill(1), 2.25],
  [2.25, ...Array<number>(10).fill(1), 2.75],
  [1, 1, 1, 1.25, 5.5, 1.25, 1],
];
/** Height of the function-key row in key units. */
export const FN_ROW = 0.62;

/** All key caps of the generic keyboard merged into ONE geometry (one draw call). */
export function keyboardGeometry(
  u: number,
  x0: number,
  z0: number,
  yFloor: number,
  keyH: number,
): THREE.BufferGeometry {
  const gap = 0.16 * u;
  const rCap = 0.11 * u;
  const cache = new Map<string, THREE.BufferGeometry>();
  const parts: THREE.BufferGeometry[] = [];
  const add = (cx: number, cz: number, wu: number, hu: number) => {
    const w = wu * u - gap;
    const h = hu * u - gap;
    const k = `${w.toFixed(2)}x${h.toFixed(2)}`;
    let g = cache.get(k);
    if (!g) {
      g = rrSlab(0, 0, w, h, rCap, 0, keyH, 0.35, 3);
      g.rotateX(-Math.PI / 2); // lie flat, top face +Y
      cache.set(k, g);
    }
    parts.push(g.clone().translate(cx, yFloor, cz));
  };
  let zRow = z0; // back edge of the current row (rows run from the hinge toward the user)
  KEY_ROWS.forEach((row, ri) => {
    const hu = ri === 0 ? FN_ROW : 1;
    const cz = zRow + (hu * u) / 2;
    let x = x0;
    for (const wu of row) {
      add(x + (wu * u) / 2, cz, wu, hu);
      x += wu * u;
    }
    if (ri === KEY_ROWS.length - 1) {
      // Inverted-T arrows: left / right at half height (front half), up + down stacked.
      const zFrontHalf = zRow + 0.75 * u;
      const zBackHalf = zRow + 0.25 * u;
      add(x + u / 2, zFrontHalf, 1, 0.5);
      add(x + 1.5 * u, zBackHalf, 1, 0.5);
      add(x + 1.5 * u, zFrontHalf, 1, 0.5);
      add(x + 2.5 * u, zFrontHalf, 1, 0.5);
    }
    zRow += hu * u;
  });
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((g) => {
    g.dispose();
  });
  cache.forEach((g) => {
    g.dispose();
  });
  return merged;
}
