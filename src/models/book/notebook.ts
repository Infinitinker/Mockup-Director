/**
 * The spiral notebook ('notebook-spiral'): two covers, a page block, punched holes and a double loop
 * wire or single coil binding on the left or top edge. Slots 'front' and 'back'.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ImageSlotDef, ModelContext, ModelDefinition, ParamDef } from '../../core/types/model';
import { round1 } from '../../core/math';
import { castShadows, placeOnGround, planarUVs, roundedRectShape } from '../geometry';
import { icon } from '../icon';
import { colorOf, mmParam, str } from '../params';
import { buildCoil, coilMaterial } from './coil';
import { coverMaterial, finishOf, finishParam } from './finish';
import { holeCenter, noteGeom } from './notebookLayout';
import { pageBlockUVs, pageMaterial } from './pageEdges';
import { BLEED, noteTemplate } from './templates';

const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_ART = 'Artwork';

/**
 * ExtrudeGeometry puts BOTH lids in group 0 (material 0). Regroup a (non-indexed, bevel-free)
 * extrusion of `depth` so only the OUTER lid uses material 0 and the inner lid joins the cut
 * edges in material 1 – otherwise the inside of a cover would show the artwork mirrored (it is
 * visible at grazing angles where the page block is inset).
 */
function outerLidOnly(geo: THREE.BufferGeometry, depth: number, outerAtTop: boolean): void {
  if (geo.index) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const old = geo.groups.map((gr) => ({ ...gr }));
  const matOf = (vert: number): number => {
    const gr = old.find((x) => vert >= x.start && vert < x.start + x.count);
    if (!gr || (gr.materialIndex ?? 0) !== 0) return 1;
    const top = pos.getZ(vert) > depth / 2;
    return top === outerAtTop ? 0 : 1;
  };
  geo.clearGroups();
  let runStart = 0;
  let runMat = -1;
  for (let v = 0; v < pos.count; v += 3) {
    const m = matOf(v);
    if (m !== runMat) {
      if (runMat >= 0) geo.addGroup(runStart, v - runStart, runMat);
      runStart = v;
      runMat = m;
    }
  }
  if (runMat >= 0) geo.addGroup(runStart, pos.count - runStart, runMat);
}

function buildNotebook(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const g = noteGeom(p);
  const { W, H, P, tc, Tf } = g;
  const b = BLEED;
  const left = g.binding === 'left';
  const finish = finishOf(p, 'satin');
  const root = new THREE.Group();
  root.name = 'Spiral notebook';

  // Covers.
  const coverShape = roundedRectShape(W, H, g.rc);
  const coverGeo = (flipU: boolean) => {
    const geo = new THREE.ExtrudeGeometry(coverShape, { depth: tc, bevelEnabled: false, curveSegments: 6 });
    // Planar artwork mapping over the trim + bleed. Front (seen from +Z): u grows with x, v with y.
    // Back (seen from -Z): u grows with -x so the image reads normally from behind; v with y.
    planarUVs(geo, 'x', 'y', flipU ? [W / 2 + b, -W / 2 - b] : [-W / 2 - b, W / 2 + b], [-H / 2 - b, H / 2 + b]);
    // Front: the outer face is the lid at z = tc; back: the lid at z = 0 (before translation).
    outerLidOnly(geo, tc, !flipU);
    return geo;
  };
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#ecebe6', roughness: 0.85, metalness: 0 });

  // Groups after outerLidOnly(): 0 = the outer face (artwork), 1 = cut edges + inner face.
  const frontGeo = coverGeo(false);
  frontGeo.translate(0, 0, P / 2);
  const front = new THREE.Mesh(frontGeo, [coverMaterial(finish, { map: ctx.getTexture('front') }), edgeMat]);
  front.name = 'front-cover';
  root.add(front);

  const backColor = colorOf(p, 'backColor', '#8e8678');
  const hasBack = ctx.hasArtwork('back');
  const backGeo = coverGeo(true);
  backGeo.translate(0, 0, -P / 2 - tc);
  const backFace = hasBack
    ? coverMaterial(finish, { map: ctx.getTexture('back') })
    : new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.88, metalness: 0 });
  const backEdge = hasBack
    ? edgeMat
    : new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.9, metalness: 0 });
  const back = new THREE.Mesh(backGeo, [backFace, backEdge]);
  back.name = 'back-cover';
  root.add(back);

  // Pages (flush on the binding edge, 0.5 mm inset on the other sides).
  const inset = 0.5;
  const pw = left ? W - inset : W - 2 * inset;
  const ph = left ? H - 2 * inset : H - inset;
  // Same corner radius as the covers: the block is only shifted inwards, so its corners never
  // poke out past the rounded cover corners (a smaller radius would on the flush binding edge).
  const pageGeo = new THREE.ExtrudeGeometry(roundedRectShape(pw, ph, g.rc), {
    depth: P,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // Flush on the binding edge: left binding -> block touches x = -W/2, top -> y = +H/2.
  pageGeo.translate(left ? -(W - pw) / 2 : 0, left ? 0 : (H - ph) / 2, -P / 2);
  pageBlockUVs(pageGeo);
  const pages = new THREE.Mesh(pageGeo, pageMaterial(colorOf(p, 'pageColor', '#f7f5ef')));
  pages.name = 'pages';
  root.add(pages);

  // Punched holes (dark decals on both covers).
  const hw = left ? g.holeAcross : g.holeAlong;
  const hh = left ? g.holeAlong : g.holeAcross;
  const holeShape = roundedRectShape(hw, hh, Math.min(hw, hh) * (g.coil === 'spiral' ? 0.5 : 0.25));
  const holeGeos: THREE.BufferGeometry[] = [];
  for (const a of g.positions) {
    const [hx, hy] = holeCenter(g, a);
    const f = new THREE.ShapeGeometry(holeShape, 8);
    f.translate(hx, hy, Tf + 0.03);
    const r = new THREE.ShapeGeometry(holeShape, 8);
    r.rotateY(Math.PI);
    r.translate(hx, hy, -Tf - 0.03);
    holeGeos.push(f, r);
  }
  const merged = mergeGeometries(holeGeos);
  holeGeos.forEach((h) => {
    h.dispose();
  });
  if (merged) {
    const holes = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({
        color: '#151515',
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    holes.name = 'holes';
    root.add(holes);
  }

  // Coil.
  const wire = buildCoil(g, coilMaterial(str(p, 'coilColor', 'silver')));
  if (wire) root.add(wire);

  castShadows(root);
  // The hole decals lie 0.03 mm above the covers – as shadow casters they would only add acne.
  const holeDecals = root.getObjectByName('holes');
  if (holeDecals) holeDecals.castShadow = false;
  placeOnGround(root);
  return root;
}

function notebookSlots(): ImageSlotDef[] {
  const g = noteGeom({});
  const aspect = (g.W + 2 * BLEED) / (g.H + 2 * BLEED);
  return [
    {
      id: 'front',
      label: 'Front',
      hint:
        `Front cover: ${round1(g.W)} × ${round1(g.H)} mm + 3 mm bleed (follows the dimensions). ` +
        'Keep the hole zone along the binding edge, marked on the template, free of important content.',
      aspect,
      template: (params) => noteTemplate(params, 'front'),
    },
    {
      id: 'back',
      label: 'Back',
      hint:
        'Back cover as seen from behind (with left binding the holes are on the right of the artwork). ' +
        'Without artwork the back uses “Back color (no artwork)”.',
      aspect,
      template: (params) => noteTemplate(params, 'back'),
    },
  ];
}

function notebookParams(): ParamDef[] {
  return [
    mmParam('width', 'Width', 148, 60, 420, 1, G_DIM),
    mmParam('height', 'Height', 210, 60, 600, 1, G_DIM),
    mmParam('thickness', 'Page block thickness', 10, 2, 40, 0.5, G_DIM),
    mmParam('coverThickness', 'Cover thickness', 0.8, 0.2, 3, 0.1, G_DIM),
    mmParam('cornerRadius', 'Corner radius', 3, 0, 15, 0.5, G_DIM),
    {
      id: 'binding',
      type: 'select',
      label: 'Binding edge',
      group: G_DIM,
      options: [
        { value: 'left', label: 'Left (notebook)' },
        { value: 'top', label: 'Top (calendar / pad)' },
      ],
      default: 'left',
    },
    {
      id: 'coil',
      type: 'select',
      label: 'Binding type',
      group: G_MAT,
      options: [
        { value: 'doubleLoop', label: 'Double loop wire' },
        { value: 'spiral', label: 'Single coil' },
      ],
      default: 'doubleLoop',
    },
    {
      id: 'coilColor',
      type: 'select',
      label: 'Coil color',
      group: G_MAT,
      options: [
        { value: 'silver', label: 'Silver' },
        { value: 'black', label: 'Black' },
        { value: 'white', label: 'White' },
      ],
      default: 'silver',
    },
    finishParam('satin'),
    { id: 'pageColor', type: 'color', label: 'Page color', group: G_MAT, default: '#f7f5ef' },
    { id: 'backColor', type: 'color', label: 'Back color (no artwork)', group: G_ART, default: '#8e8678' },
  ];
}

const ICON_NOTEBOOK = icon(
  '<rect x="19" y="6" width="34" height="52" rx="3"/>' +
    [12, 20, 28, 36, 44, 52].map((y) => `<path d="M24 ${y - 2}h-8a2.5 2.5 0 0 0 0 5h8"/>`).join('') +
    '<path d="M30 22h16M30 28h11"/>',
);

export const spiralNotebookModel: ModelDefinition = {
  id: 'notebook-spiral',
  category: 'book',
  name: 'Spiral notebook',
  description:
    'A5 notebook / calendar with a double loop wire or single coil binding on the left or top edge, covers and a page block.',
  icon: ICON_NOTEBOOK,
  slots: notebookSlots(),
  params: notebookParams(),
  defaultCamera: { yaw: -28, pitch: 16 },
  build: buildNotebook,
};
