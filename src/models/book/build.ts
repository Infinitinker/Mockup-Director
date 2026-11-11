/**
 * Builds a hardcover or paperback: the printed cover over the boards (one wrap or front, spine and
 * back), the inside of the cover, the page block and the hardcover's headbands.
 *
 * The printed artwork is mapped by ARC LENGTH along the outer surface of the cover's cross-section:
 * the wrap image is exactly the flat cover sheet that would be wrapped round the book (Back | Spine |
 * Front).
 */
import * as THREE from 'three';
import type { ModelContext } from '../../core/types/model';
import { clamp } from '../../core/math';
import { castShadows, placeOnGround } from '../geometry';
import { bool, colorOf } from '../params';
import { type BookGeom, type BookKind, bookGeom, bookProfile } from './cover';
import { coverMaterial, finishOf } from './finish';
import { pageBlockUVs, pageMaterial } from './pageEdges';
import { addRibbon, MeshBuilder, type PNode, Profile } from './profile';
import { BLEED } from './templates';

const PI = Math.PI;
const ESEG = 4; // fore-edge rounding segments

/** Page block cross-section as a Shape in (x, -z) – extruded along +Z then rotated up to +Y. */
function pageBlockShape(g: BookGeom): THREE.Shape {
  const P = g.P;
  const W = g.W;
  const pts: [number, number][] = []; // (x, z)
  if (g.rounded) {
    // Convex spine (left) and the matching concave fore-edge (right) of a rounded-and-backed block.
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const z = -P / 2 + (P * i) / N;
      pts.push([g.xsC - Math.sqrt(Math.max(g.Rpb * g.Rpb - z * z, 0)), z]);
    }
    for (let i = 0; i <= N; i++) {
      const z = P / 2 - (P * i) / N;
      pts.push([W + g.xsC - Math.sqrt(Math.max(g.Rpb * g.Rpb - z * z, 0)), z]);
    }
  } else {
    // Flat spine; for a paperback the spine corners follow the cover's corner rounding.
    const r = g.kind === 'soft' ? clamp(g.rc - g.tb - g.gapS, 0, P / 2 - 0.01) : 0;
    pts.push([W, -P / 2], [W, P / 2]);
    if (r > 0) {
      for (let i = 0; i <= 4; i++) {
        const t = PI / 2 + ((PI / 2) * i) / 4;
        pts.push([r + r * Math.cos(t), P / 2 - r + r * Math.sin(t)]);
      }
      for (let i = 0; i <= 4; i++) {
        const t = PI + ((PI / 2) * i) / 4;
        pts.push([r + r * Math.cos(t), -P / 2 + r + r * Math.sin(t)]);
      }
    } else {
      pts.push([0, P / 2], [0, -P / 2]);
    }
  }
  return new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
}

function buildPageBlock(g: BookGeom, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(pageBlockShape(g), { depth: g.H, bevelEnabled: false, curveSegments: 4 });
  // Shape (x, -z) extruded along +Z by H  ->  rotateX(-90°): world y = extrusion, world z = -shapeY.
  geo.rotateX(-PI / 2);
  geo.translate(0, g.yBlock, 0);
  pageBlockUVs(geo);
  const m = new THREE.Mesh(geo, mat);
  m.name = 'pages';
  return m;
}

/** Head- and tail-bands: thin rolled cords glued to the top and bottom of a hardcover spine. */
function buildHeadbands(g: BookGeom, color: string): THREE.Mesh[] {
  const r = 0.75;
  const zMax = g.P / 2 - 0.25;
  const pts: THREE.Vector3[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const z = -zMax + (2 * zMax * i) / N;
    const x = g.rounded ? g.xsC - Math.sqrt(Math.max(g.Rpb * g.Rpb - z * z, 0)) + 0.8 : 0.8;
    pts.push(new THREE.Vector3(x, 0, z));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 6, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
  const top = new THREE.Mesh(geo, mat);
  top.position.y = g.yBlock + g.H - 0.2;
  const bottom = new THREE.Mesh(geo, mat);
  bottom.position.y = g.yBlock + 0.2;
  top.name = 'headband';
  bottom.name = 'tailband';
  return [top, bottom];
}

export function buildBook(ctx: ModelContext, kind: BookKind): THREE.Object3D {
  const p = ctx.params;
  const g = bookGeom(p, kind);
  const outer = bookProfile(g, 0);
  const inner = bookProfile(g, -g.tb);
  const O = outer.prof.nodes;
  const I = inner.prof.nodes;
  const last = O.length - 1;
  const wrapLen = O[last].s;
  const s0 = O[outer.marks.fold0].s;
  const s1 = O[outer.marks.fold1].s;

  const b = BLEED;
  const Hc = g.Hc;
  const hTot = Hc + 2 * b;
  /** v of a height on the cover: y = 0 (bottom trim) -> bleed, y = Hc -> top trim. */
  const V = (y: number) => (b + y) / hTot;
  /** How far the board edges reach into the bleed of the artwork. */
  const k = Math.min(g.tb, 0.9 * b);

  const finish = finishOf(p, kind === 'hard' ? 'matte' : 'gloss');
  const sideColor = colorOf(p, 'sideColor', kind === 'hard' ? '#2c3445' : '#ece9e2');

  const root = new THREE.Group();
  root.name = kind === 'hard' ? 'Hardcover book' : 'Paperback book';

  // Fore-edge end pieces (rounded board edge).
  // Front: from the outer face round the fore-edge down to the board's inner face.
  const E = new Profile().start(O[last].x, O[last].z, 0, 1);
  E.arc(g.xF - g.re, g.Tz - g.re, g.re, PI / 2, 0, ESEG);
  E.lineTo(g.xF, g.Tz - g.tb);
  // Back: from the board's inner face up the fore-edge round to the outer face.
  const B = new Profile().start(g.xF, -g.Tz + g.tb, 1, 0);
  B.lineTo(g.xF, -g.Tz + g.re);
  B.arc(g.xF - g.re, -g.Tz + g.re, g.re, 0, -PI / 2, ESEG);
  const En = E.nodes;
  const Bn = B.nodes;
  const lenE = En[En.length - 1].s;
  const lenB = Bn[Bn.length - 1].s;
  // Artwork position (mm from the back trim) of the end-piece nodes, squeezed into the bleed.
  const sE = (j: number) => wrapLen + En[j].s * Math.min(1, k / Math.max(lenE, 1e-6));
  const sB = (j: number) => -(lenB - Bn[j].s) * Math.min(1, k / Math.max(lenB, 1e-6));
  /** 0 on the outer cover surface -> 1 at the board's inner face (for the cap v). */
  const depthOf = (z: number) => clamp((g.Tz - Math.abs(z)) / g.tb, 0, 1);

  /**
   * One printed part of the cover: outer ribbon over O[i0..i1], the matching board edges (top /
   * bottom caps) and, optionally, the fore-edge end pieces. U maps an artwork position (mm from
   * the back fore-edge trim along the outer surface, may run into the bleed) to the texture u.
   */
  const addPart = (
    i0: number,
    i1: number,
    mat: THREE.Material,
    U: (s: number) => number,
    withB: boolean,
    withE: boolean,
    name: string,
  ) => {
    const mb = new MeshBuilder();
    const slice = O.slice(i0, i1 + 1);
    // Outer face. UV: u runs along the developed cover (arc length), v up the height. The path
    // runs back fore-edge -> spine -> front fore-edge, i.e. left -> right as seen from outside on
    // every face (back seen from behind, spine from the left, front from the front), and y = 0 is
    // the image bottom, so no face is mirrored or upside-down.
    addRibbon(mb, slice, 0, Hc, 1, (i) => U(slice[i].s), V);

    // Board edges at the top (+Y) and bottom (-Y): the artwork continues over the edge into the
    // bleed (as the real cover sheet turns over the boards).
    for (const top of [true, false]) {
      const y = top ? Hc : 0;
      const ny = top ? 1 : -1;
      const vAt = (depth: number) => V(top ? Hc + k * depth : -k * depth);
      let prevO = -1;
      let prevI = -1;
      for (let i = i0; i <= i1; i++) {
        const u = U(O[i].s);
        const o = mb.vert(O[i].x, y, O[i].z, 0, ny, 0, u, vAt(0));
        const n = mb.vert(I[i].x, y, I[i].z, 0, ny, 0, u, vAt(1));
        if (prevO >= 0) mb.quad(prevO, o, n, prevI);
        prevO = o;
        prevI = n;
      }
      // Fans closing the board corner at the fore-edge(s).
      const fan = (nodes: PNode[], sOf: (j: number) => number, center: PNode) => {
        const c = mb.vert(center.x, y, center.z, 0, ny, 0, U(center.s), vAt(1));
        let prev = -1;
        nodes.forEach((n, j) => {
          const vtx = mb.vert(n.x, y, n.z, 0, ny, 0, U(sOf(j)), vAt(depthOf(n.z)));
          if (prev >= 0) mb.tri(c, prev, vtx);
          prev = vtx;
        });
      };
      if (withE) fan(En, sE, { ...I[last], s: wrapLen });
      if (withB) fan(Bn, sB, { ...I[0], s: 0 });
    }

    // Fore-edge faces of the boards (artwork continues into the side bleed).
    if (withE) addRibbon(mb, En, 0, Hc, 1, (j) => U(sE(j)), V);
    if (withB) addRibbon(mb, Bn, 0, Hc, 1, (j) => U(sB(j)), V);

    const mesh = new THREE.Mesh(mb.geometry(), mat);
    mesh.name = name;
    root.add(mesh);
  };

  const useCover = ctx.hasArtwork('cover');
  if (useCover) {
    // One wrap image: Back | Spine | Front.
    const wTot = wrapLen + 2 * b;
    addPart(
      0,
      last,
      coverMaterial(finish, { map: ctx.getTexture('cover') }),
      (s) => (b + s) / wTot,
      true,
      true,
      'cover',
    );
  } else {
    // Separate panels; the front always shows an image (placeholder when empty), empty spine /
    // back fall back to a solid color.
    const iF0 = outer.marks.fold1;
    const iB1 = outer.marks.fold0;
    const fw = wrapLen - s1 + 2 * b;
    const sw = s1 - s0 + 2 * b;
    const bw = s0 + 2 * b;
    addPart(
      iF0,
      last,
      coverMaterial(finish, { map: ctx.getTexture('front') }),
      (s) => (b + s - s1) / fw,
      false,
      true,
      'front',
    );
    const spineMat = ctx.hasArtwork('spine')
      ? coverMaterial(finish, { map: ctx.getTexture('spine') })
      : coverMaterial(finish, { color: sideColor });
    addPart(iB1, iF0, spineMat, (s) => (b + s - s0) / sw, false, false, 'spine');
    const backMat = ctx.hasArtwork('back')
      ? coverMaterial(finish, { map: ctx.getTexture('back') })
      : coverMaterial(finish, { color: sideColor });
    addPart(0, iB1, backMat, (s) => (b + s) / bw, true, false, 'back');
  }

  // Inside of the cover (endpapers / reverse of the cover card).
  {
    const mb = new MeshBuilder();
    const nodes: PNode[] = [{ ...Bn[0], nx: 0, nz: -1 }, ...I, { ...En[En.length - 1], nx: 0, nz: 1 }];
    addRibbon(
      mb,
      nodes,
      0,
      Hc,
      -1,
      () => 0,
      () => 0,
    );
    const endpaper = new THREE.MeshStandardMaterial({
      color: kind === 'hard' ? '#efeadf' : '#f4f3ef',
      roughness: 0.85,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(mb.geometry(), endpaper);
    mesh.name = 'cover-inside';
    root.add(mesh);
  }

  // Page block.
  root.add(buildPageBlock(g, pageMaterial(colorOf(p, 'pageColor', kind === 'hard' ? '#f3ecdc' : '#f1ead8'))));
  if (kind === 'hard' && bool(p, 'headband', true))
    root.add(...buildHeadbands(g, colorOf(p, 'headbandColor', '#8a1c22')));

  castShadows(root);
  placeOnGround(root);
  return root;
}
