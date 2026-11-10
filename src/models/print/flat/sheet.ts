/**
 * One flat print sheet or card, built "standing" in its own frame (see the conventions in
 * core/types/model.ts): millimeters, artwork in the XY plane, FRONT facing +Z, thickness along Z,
 * centered on the origin. Flat with rounded corners, or bent along its long edge. The BACK of a
 * sheet is "turned over like a book page" (around the vertical axis): seen from behind, it reads
 * normally, top still at the top.
 */
import * as THREE from 'three';
import { clamp } from '../../../core/math';
import { planarUVs, roundedRectShape } from '../../geometry';
import type { UVRect } from '../templates';
import { MeshBuilder, type Vtx } from './meshBuilder';

const deg = THREE.MathUtils.degToRad;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Geometries of one sheet / card (front print, back print, cut edge). */
interface SheetGeometries {
  front: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  edge: THREE.BufferGeometry;
}
export interface SheetMaterials {
  front: THREE.Material;
  back: THREE.Material;
  edge: THREE.Material;
}

/** Side wall of a closed 2D outline extruded from z = -t/2 to +t/2 (flat-shaded per segment). */
function edgeFromOutline(outline: THREE.Vector2[], t: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (const p of outline) if (!pts.length || pts[pts.length - 1].distanceTo(p) > 1e-6) pts.push(p);
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const ccw = area > 0;
  const mb = new MeshBuilder();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Outward normal: direction rotated -90° for a counter-clockwise outline.
    const n = ccw ? new THREE.Vector3(dy / len, -dx / len, 0) : new THREE.Vector3(-dy / len, dx / len, 0);
    mb.quad(
      { p: new THREE.Vector3(a.x, a.y, -t / 2), n },
      { p: new THREE.Vector3(b.x, b.y, -t / 2), n },
      { p: new THREE.Vector3(b.x, b.y, t / 2), n },
      { p: new THREE.Vector3(a.x, a.y, t / 2), n },
    );
  }
  return mb.build();
}

/**
 * Flat card / sheet w x h x t with rounded corners r, centered on the origin, front facing +Z.
 * `frontRect` / `backRect` give the image area mapped onto the trim of each face.
 */
export function flatSheetGeometries(
  w: number,
  h: number,
  t: number,
  r: number,
  frontRect: UVRect,
  backRect: UVRect,
): SheetGeometries {
  const shape = roundedRectShape(w, h, r);
  const segs = 8;
  // FRONT (+Z): u grows with +x, v with +y -> upright and not mirrored when seen from the front.
  const front = new THREE.ShapeGeometry(shape, segs);
  planarUVs(front, 'x', 'y', [-w / 2, w / 2], [-h / 2, h / 2], frontRect);
  front.translate(0, 0, t / 2);
  // BACK (-Z): the shape turned around the vertical axis (like a book page). Seen from behind the
  // viewer's right is -X, so u runs from x = +w/2 to -w/2; v still grows with +y -> reads normally.
  const back = new THREE.ShapeGeometry(shape, segs);
  back.rotateY(Math.PI);
  planarUVs(back, 'x', 'y', [w / 2, -w / 2], [-h / 2, h / 2], backRect);
  back.translate(0, 0, -t / 2);
  return { front, back, edge: edgeFromOutline(shape.getPoints(segs), t) };
}

/** Total arc angle of a fully bent flyer (bend = 100 %). */
const MAX_BEND = deg(45);

/**
 * Sheet w x h x t (square corners) bent along its LONG edge into a cylindrical arc: `bend` 0..1,
 * 0 = flat. The front is the concave side, so a sheet lying flat lifts its ends a little (like a
 * freshly unpacked flyer). Arc length is preserved, so the artwork is not stretched.
 */
export function bentSheetGeometries(
  w: number,
  h: number,
  t: number,
  bend: number,
  frontRect: UVRect,
  backRect: UVRect,
): SheetGeometries {
  const longY = h >= w;
  const len = longY ? h : w;
  const theta = clamp(bend, 0, 1) * MAX_BEND;
  const R = theta > 1e-4 ? len / theta : Infinity;
  const segs = Number.isFinite(R) ? 40 : 1;
  const nu = longY ? 1 : segs;
  const nv = longY ? segs : 1;

  /** Mid-surface point, unit normal (front side) and tangents for sheet coordinates (x, y). */
  const mid = (x: number, y: number) => {
    if (!Number.isFinite(R)) {
      return {
        p: new THREE.Vector3(x, y, 0),
        n: new THREE.Vector3(0, 0, 1),
        tx: new THREE.Vector3(1, 0, 0),
        ty: new THREE.Vector3(0, 1, 0),
      };
    }
    const phi = (longY ? y : x) / R;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const along = R * s;
    const z = R * (1 - c);
    return longY
      ? {
          p: new THREE.Vector3(x, along, z),
          n: new THREE.Vector3(0, -s, c),
          tx: new THREE.Vector3(1, 0, 0),
          ty: new THREE.Vector3(0, c, s),
        }
      : {
          p: new THREE.Vector3(along, y, z),
          n: new THREE.Vector3(-s, 0, c),
          tx: new THREE.Vector3(c, 0, s),
          ty: new THREE.Vector3(0, 1, 0),
        };
  };
  const X = (i: number) => -w / 2 + (w * i) / nu;
  const Y = (j: number) => -h / 2 + (h * j) / nv;
  const offset = (m: ReturnType<typeof mid>, d: number) => m.p.clone().addScaledVector(m.n, d);

  const fb = new MeshBuilder();
  const bb = new MeshBuilder();
  const [fu0, fv0, fu1, fv1] = frontRect;
  const [bu0, bv0, bu1, bv1] = backRect;
  const frontRows: Vtx[][] = [];
  const backRows: Vtx[][] = [];
  for (let j = 0; j <= nv; j++) {
    const fr: Vtx[] = [];
    const br: Vtx[] = [];
    for (let i = 0; i <= nu; i++) {
      const x = X(i);
      const y = Y(j);
      const m = mid(x, y);
      const tu = (x + w / 2) / w;
      const tv = (y + h / 2) / h;
      // FRONT: u grows with +x (left -> right seen from the front), v with +y (bottom -> top).
      fr.push({ p: offset(m, t / 2), n: m.n, uv: [lerp(fu0, fu1, tu), lerp(fv0, fv1, tv)] });
      // BACK: turned like a page – seen from behind, +x is on the viewer's LEFT, so u = 1 - tu.
      br.push({ p: offset(m, -t / 2), n: m.n.clone().negate(), uv: [lerp(bu0, bu1, 1 - tu), lerp(bv0, bv1, tv)] });
    }
    frontRows.push(fr);
    backRows.push(br);
  }
  for (let j = 0; j < nv; j++) {
    fb.strip(frontRows[j], frontRows[j + 1]);
    bb.strip(backRows[j], backRows[j + 1]);
  }

  // Cut edges: rows of (front, back) points along each border, normals = outward tangents.
  const eb = new MeshBuilder();
  const edgeRows = (pts: [number, number][], outward: (m: ReturnType<typeof mid>) => THREE.Vector3) => {
    const f: Vtx[] = [];
    const b: Vtx[] = [];
    for (const [x, y] of pts) {
      const m = mid(x, y);
      const n = outward(m);
      f.push({ p: offset(m, t / 2), n });
      b.push({ p: offset(m, -t / 2), n });
    }
    eb.strip(f, b);
  };
  const along = (count: number, f: (k: number) => [number, number]) =>
    Array.from({ length: count + 1 }, (_, k) => f(k));
  edgeRows(
    along(nu, (i) => [X(i), -h / 2]),
    (m) => m.ty.clone().negate(),
  );
  edgeRows(
    along(nu, (i) => [X(i), h / 2]),
    (m) => m.ty.clone(),
  );
  edgeRows(
    along(nv, (j) => [-w / 2, Y(j)]),
    (m) => m.tx.clone().negate(),
  );
  edgeRows(
    along(nv, (j) => [w / 2, Y(j)]),
    (m) => m.tx.clone(),
  );

  return { front: fb.build(), back: bb.build(), edge: eb.build() };
}

/** One sheet as three meshes sharing the given geometries / materials. */
export function sheetMeshes(geos: SheetGeometries, mats: SheetMaterials): THREE.Group {
  const g = new THREE.Group();
  const front = new THREE.Mesh(geos.front, mats.front);
  front.name = 'front';
  const back = new THREE.Mesh(geos.back, mats.back);
  back.name = 'back';
  const edge = new THREE.Mesh(geos.edge, mats.edge);
  edge.name = 'edge';
  g.add(front, back, edge);
  return g;
}
