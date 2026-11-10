/**
 * buildJewelCase: the CD jewel case with its lid, booklet, base, inlay, tray and the optional disc
 * inside; the "CD case with disc" composite reuses it.
 */
import * as THREE from 'three';
import type { ModelContext } from '../../../core/types/model';
import { castShadows, roundedRectShape } from '../../geometry';
import { clearPlastic, printMaterial } from '../../materials';
import { bool, str } from '../../params';
import { buildDisc } from '../build';
import { discSlot } from '../label';
import {
  BLEED,
  BOOKLET,
  BOOKLET_TEMPLATE,
  CX,
  CY,
  H,
  IH,
  INLAY_BACK,
  INLAY_H,
  INLAY_SPINE,
  IW,
  LAYOUTS,
  W,
  X_FOLD_L,
  X_FOLD_R,
} from './layout';
import { boxGeo, cornerShape, extrudeXZ, facingPlane, remapBoxFace, uvRect } from './shapes';
import { buildTray, trayMaterial } from './tray';

const PAPER: Record<string, { roughness: number; gloss: number }> = {
  matte: { roughness: 0.78, gloss: 0 },
  satin: { roughness: 0.5, gloss: 0.3 },
  gloss: { roughness: 0.3, gloss: 0.9 },
};

/** CD jewel case (front booklet + back inlay with spines). Root on the ground, front = +Z, mm. */
export function buildJewelCase(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const slim = str(p, 'variant', 'standard') === 'slim';
  const Ly = slim ? LAYOUTS.slim : LAYOUTS.standard;
  const trayColor = str(p, 'trayColor', 'black');
  const trayIsSeeThrough = trayColor === 'clear' || trayColor === 'smoke';
  const paper = PAPER[str(p, 'paperFinish', 'satin')] ?? PAPER.satin;
  const half = Ly.depth / 2;

  const root = new THREE.Group();
  root.name = 'cd-jewel-case';

  // Shared clear-plastic materials: faces are nearly invisible, the cut edges of the acrylic-like
  // polystyrene catch more light (as on a real case). Outer shell draws last among transparents.
  const clearFace = clearPlastic({ tint: '#f5f9fa', opacity: 0.1, roughness: 0.03 });
  const clearEdge = clearPlastic({ tint: '#dbe7e6', opacity: 0.42, roughness: 0.08 });
  const SHELL_ORDER = 10;
  const shell = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], name?: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = SHELL_ORDER;
    if (name) m.name = name;
    root.add(m);
    return m;
  };
  /** Box materials: the two large faces on the given axis = clearFace, the rest = clearEdge. */
  const boxMats = (axis: 'x' | 'y' | 'z'): THREE.Material[] => {
    const f = (a: 'x' | 'y' | 'z') => (a === axis ? clearFace : clearEdge);
    return [f('x'), f('x'), f('y'), f('y'), f('z'), f('z')];
  };

  // Lid
  const lidGeo = new THREE.ExtrudeGeometry(roundedRectShape(W, H, 1.2), {
    depth: Ly.lid1 - Ly.lid0,
    bevelEnabled: false,
    curveSegments: 6,
  });
  lidGeo.translate(0, CY, Ly.lid0);
  shell(lidGeo, [clearFace, clearEdge], 'lid');

  // Hinge strip ridges on the front, left edge.
  for (let i = 0; i < 5; i++) {
    const x = -69.2 + i * 1.45;
    shell(boxGeo(x - 0.3, x + 0.3, 3, H - 3, Ly.lid1, Ly.ribTop), clearEdge);
  }

  // Top / bottom flanges of the lid (they wrap over the base).
  const kW = 7; // knuckle width (x)
  shell(boxGeo(-W / 2 + kW, W / 2, H - 1.2, H, Ly.flange0, Ly.lid0), boxMats('y'));
  shell(boxGeo(-W / 2 + kW, W / 2, 0, 1.2, Ly.flange0, Ly.lid0), boxMats('y'));

  // Hinge knuckles at the top-left and bottom-left corners + the pins they snap onto.
  const kr = Ly.knuckleR;
  const kProfile = () => cornerShape(-W / 2, -W / 2 + kW, Ly.knuckle0, Ly.lid0, [kr, 0.4, 0.4, 0.6]);
  const kLen = 10.5;
  shell(extrudeXZ(kProfile(), 0, kLen), [clearFace, clearEdge]);
  shell(extrudeXZ(kProfile(), H - kLen, H), [clearFace, clearEdge]);
  const pinR = Math.max(0.8, kr * 0.45);
  const pinZ = Math.min(Ly.lid0 - pinR - 0.3, Ly.knuckle0 + kr);
  for (const [y0, y1] of [
    [kLen, kLen + 2.5],
    [H - kLen - 2.5, H - kLen],
  ]) {
    const pin = new THREE.CylinderGeometry(pinR, pinR, y1 - y0, 20);
    pin.translate(-W / 2 + kr, (y0 + y1) / 2, pinZ);
    shell(pin, clearEdge);
  }

  // Booklet tabs: small clips at the right edge and under the hinge strip.
  for (const yc of [25, H - 25]) {
    shell(
      boxGeo(CX + BOOKLET / 2 - 0.8, CX + BOOKLET / 2 + 2.8, yc - 5, yc + 5, Ly.booklet0 - 0.3, Ly.lid0),
      boxMats('z'),
    );
    shell(
      boxGeo(CX - BOOKLET / 2 - 2.2, CX - BOOKLET / 2 + 1.6, yc - 5, yc + 5, Ly.booklet0 - 0.3, Ly.lid0),
      boxMats('z'),
    );
  }

  // Booklet
  if (bool(p, 'showBooklet', true)) {
    const bt = Ly.booklet1 - Ly.booklet0;
    const bGeo = new THREE.BoxGeometry(BOOKLET, BOOKLET, bt);
    // Front face shows the trim area of the template (bleed falls outside the face).
    remapBoxFace(
      bGeo,
      4,
      ...uvRect(BLEED, BLEED, BOOKLET, BOOKLET, BOOKLET_TEMPLATE.widthMm, BOOKLET_TEMPLATE.heightMm),
    );
    bGeo.translate(CX, CY, (Ly.booklet0 + Ly.booklet1) / 2);
    const paperEdge = new THREE.MeshPhysicalMaterial({ color: '#f1efe9', roughness: 0.85 });
    const front = printMaterial(ctx.getTexture('booklet'), { roughness: paper.roughness, gloss: paper.gloss });
    const booklet = new THREE.Mesh(bGeo, [paperEdge, paperEdge, paperEdge, paperEdge, front, paperEdge]);
    booklet.name = 'booklet';
    root.add(booklet);
  }

  // Base
  const trayMat = trayMaterial(trayColor);
  const trayOrder = trayIsSeeThrough ? 1 : 0;
  if (slim) {
    // One-piece base = tray material: back plate (full size) + tray body between the flanges.
    const back = new THREE.Mesh(boxGeo(-W / 2, W / 2, 0, H, -half, Ly.backPlateFront), trayMat);
    back.renderOrder = trayOrder;
    root.add(back);
    // The tray starts 0.1 mm in from the hinge side: at exactly x = -W/2 its rim wall would be
    // coplanar with the clear hinge knuckles' outer wall and z-fight there (speckles on the hinge).
    root.add(buildTray(trayMat, -W / 2 + 0.1, W / 2, 1.2, H - 1.2, Ly, trayOrder));
  } else {
    // Clear base shell: back plate + left/right spine walls (the inlay spines show through them).
    shell(boxGeo(-W / 2, W / 2, 0, H, -half, Ly.backPlateFront), boxMats('z'), 'base-back');
    shell(boxGeo(W / 2 - 1.6, W / 2, 1.2, H - 1.2, Ly.backPlateFront, Ly.booklet1), boxMats('x'));
    shell(boxGeo(-W / 2, -W / 2 + 1.6, 1.2, H - 1.2, Ly.backPlateFront, Ly.booklet1), boxMats('x'));
    root.add(buildTray(trayMat, -68.7, 68.7, 1.5, H - 1.5, Ly, trayOrder));
  }

  // Inlay (tray card)
  // Standard: always present (artwork, or a plain card in inlayColor). Slim: only the back,
  // and only when an inlay image is supplied and the base is see-through.
  const hasInlay = ctx.hasArtwork('inlay');
  if (!slim || (hasInlay && trayIsSeeThrough)) {
    const outer = hasInlay
      ? printMaterial(ctx.getTexture('inlay'), { roughness: paper.roughness, gloss: paper.gloss })
      : new THREE.MeshPhysicalMaterial({
          color: str(p, 'inlayColor', '#ffffff'),
          roughness: paper.roughness,
          clearcoat: paper.gloss,
          clearcoatRoughness: 0.1,
        });
    const inner = new THREE.MeshPhysicalMaterial({ color: '#f1efe9', roughness: 0.85 });
    const xb = INLAY_BACK / 2;
    const yc = CY;

    const backGeo = facingPlane(INLAY_BACK, INLAY_H, '-z', uvRect(X_FOLD_L, BLEED, INLAY_BACK, INLAY_H, IW, IH));
    backGeo.translate(0, yc, Ly.inlayZ);
    const backMesh = new THREE.Mesh(backGeo, outer);
    backMesh.name = 'inlay-back';
    root.add(backMesh);
    const backInner = facingPlane(INLAY_BACK, INLAY_H, '+z');
    backInner.translate(0, yc, Ly.inlayZ + 0.12);
    root.add(new THREE.Mesh(backInner, inner));

    if (Ly.spines) {
      const zc = Ly.inlayZ + INLAY_SPINE / 2;
      const xs = xb + 0.05;
      // Template LEFT spine → case right side (+X); u runs front (+Z) → fold (back).
      const rightSide = facingPlane(INLAY_SPINE, INLAY_H, '+x', uvRect(BLEED, BLEED, INLAY_SPINE, INLAY_H, IW, IH));
      rightSide.translate(xs, yc, zc);
      // Template RIGHT spine → hinge side (-X); u runs fold (back) → front (+Z).
      const leftSide = facingPlane(INLAY_SPINE, INLAY_H, '-x', uvRect(X_FOLD_R, BLEED, INLAY_SPINE, INLAY_H, IW, IH));
      leftSide.translate(-xs, yc, zc);
      const r = new THREE.Mesh(rightSide, outer);
      r.name = 'inlay-spine-right';
      const l = new THREE.Mesh(leftSide, outer);
      l.name = 'inlay-spine-left';
      root.add(r, l);
      const ri = facingPlane(INLAY_SPINE, INLAY_H, '-x');
      ri.translate(xs - 0.12, yc, zc);
      const li = facingPlane(INLAY_SPINE, INLAY_H, '+x');
      li.translate(-xs + 0.12, yc, zc);
      root.add(new THREE.Mesh(ri, inner), new THREE.Mesh(li, inner));
    }
  }

  // Disc in the tray
  if (bool(p, 'showDisc', false)) {
    // buildDisc lies flat (label +Y); rotateX(+90°) turns the label to +Z with the artwork upright.
    const holder = new THREE.Group();
    holder.rotation.x = Math.PI / 2;
    holder.position.set(CX, CY, Ly.trayFloor + Ly.hubH);
    holder.add(buildDisc(ctx, discSlot.id));
    root.add(holder);
  }

  castShadows(root);
  return root;
}
