/**
 * buildKeepCase: the DVD or Blu-ray keep case, a plastic case with a printed paper insert under a
 * clear sleeve film; the composites reuse it.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, case standing upright on
 * y = 0, centered on x/z, FRONT cover faces +Z, the SPINE is on the left when looking at the
 * front (-X side), the open edge on the right (+X).
 */
import * as THREE from 'three';
import type { ModelContext } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { clearPlastic, printMaterial } from '../../materials';
import { bool, num, str } from '../../params';
import { plasticMaterial, roundedRect, roundedSlab, seamMaterial } from './plastic';
import { crossSection, halfLenTo, openEdgeLine, openEdgeOutline, ribbon, slicePath, type Pt } from './ribbon';
import {
  BAND_PROUD,
  BLEED,
  edgeRadius,
  FILM_OFFSET,
  FINISH_ROUGHNESS,
  PLASTICS,
  SHEET_OFFSET,
  SPECS,
  thicknessOf,
  type KeepCaseVariant,
} from './specs';

/** DVD / Blu-ray keep case with wrap-around cover sheet. Root on the ground, front = +Z, mm. */
export function buildKeepCase(ctx: ModelContext, variant: KeepCaseVariant): THREE.Object3D {
  const spec = SPECS[variant];
  const p = ctx.params;
  const W = spec.width;
  const H = spec.height;
  const T = thicknessOf(p, variant);
  const r = edgeRadius(T); // rounded long edges (spine / side edges)
  const rc = clamp(num(p, 'cornerRadius', 3), r + 0.4, 6); // front-view corner radius
  const ob = BAND_PROUD;
  // Blu-ray: the band's outer surface defines the full height, the body sits just inside it.
  const Hbody = spec.band ? H - ob : H;

  const plastic = PLASTICS[str(p, 'plastic', spec.defaultPlastic)] ?? PLASTICS[spec.defaultPlastic];
  const translucent = plastic.opacity !== undefined;
  const gloss = clamp(num(p, 'sleeveGloss', 85), 0, 100) / 100;
  const paperRough = FINISH_ROUGHNESS[str(p, 'coverFinish', 'satin')] ?? FINISH_ROUGHNESS.satin;
  const sideColor = str(p, 'sideColor', '#1c1c1f');

  const root = new THREE.Group();
  root.name = variant === 'dvd' ? 'DVD keep case' : 'Blu-ray keep case';

  // Plastic body
  const body = new THREE.Mesh(
    roundedSlab(roundedRect(-W / 2 + r, r, W / 2 - r, Hbody - r, rc - r, rc - r), T, r),
    plasticMaterial(plastic),
  );
  body.name = 'case';
  body.castShadow = true;
  root.add(body);

  // Printed insert
  const pw = spec.panelWidth;
  const hi = spec.insertHeight;
  const y0 = spec.insertBottom;
  const y1 = y0 + hi;
  const halfLen = T / 2 + pw; // spine center -> open-edge end of each panel
  const sheet = crossSection(W, T, r, SHEET_OFFSET, halfLen);
  const sTotal = sheet[sheet.length - 1].s;
  const sSpine0 = sTotal / 2 - T / 2; // fold back | spine
  const sSpine1 = sTotal / 2 + T / 2; // fold spine | front
  // Template x (mm from the trim-left edge) for a path position. Arc length is mapped 1:1, so the
  // spine region of the artwork covers exactly the spine and the folds sit on the rounded edges.
  const tplX = (s: number) => s - (sSpine0 - pw);
  const v = (y: number, hTot: number) => (BLEED + (y - y0)) / hTot;
  const hTot = hi + 2 * BLEED;

  const clearcoat = 0.35 + 0.65 * gloss;
  const clearcoatRoughness = 0.02 + (1 - gloss) * 0.35;
  const paper = (map: THREE.Texture) => {
    const m = printMaterial(map, { roughness: paperRough, gloss: clearcoat });
    m.clearcoatRoughness = clearcoatRoughness;
    return m;
  };
  const solidPaper = () =>
    new THREE.MeshPhysicalMaterial({
      color: sideColor,
      roughness: paperRough,
      metalness: 0,
      clearcoat,
      clearcoatRoughness,
    });

  const addSheet = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    root.add(m);
  };

  // With no artwork at all we fall through to the separate-panel path so the placeholder label lands
  // on the FRONT (a centered wrap placeholder would put its label on the spine).
  const useCover = ctx.hasArtwork('cover');
  if (useCover) {
    // One wrap image: Back | Spine | Front.
    const wTot = 2 * pw + T + 2 * BLEED;
    const geo = ribbon(sheet, 'xz', y0, y1, (s, y) => [(BLEED + tplX(s)) / wTot, v(y, hTot)]);
    addSheet(geo, paper(ctx.getTexture('cover')), 'cover');
  } else {
    const panel = (s0: number, s1: number, width: number) =>
      ribbon(slicePath(sheet, s0, s1), 'xz', y0, y1, (s, y) => [(BLEED + (s - s0)) / (width + 2 * BLEED), v(y, hTot)]);
    addSheet(panel(sSpine1, sTotal, pw), paper(ctx.getTexture('front')), 'front');
    addSheet(
      panel(sSpine0, sSpine1, T),
      ctx.hasArtwork('spine') ? paper(ctx.getTexture('spine')) : solidPaper(),
      'spine',
    );
    addSheet(panel(0, sSpine0, pw), ctx.hasArtwork('back') ? paper(ctx.getTexture('back')) : solidPaper(), 'back');
  }

  if (translucent) {
    // Through a see-through case the reverse (white) side of the paper insert is visible.
    const inner = crossSection(W, T, r, SHEET_OFFSET - 0.05, halfLen);
    const back = new THREE.Mesh(
      ribbon(inner, 'xz', y0, y1, undefined, true),
      new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.85, metalness: 0 }),
    );
    back.name = 'insert-reverse';
    root.add(back);
  }

  // Blu-ray molded top band
  // It overlaps the top of the insert slightly (as on real cases, the sheet tucks under it).
  const yBand = y1 - 2;
  if (spec.band) {
    const bandMat = new THREE.MeshPhysicalMaterial({
      color: str(p, 'bandColor', '#1d62cc'),
      roughness: 0.14,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.88,
      // Writes depth so parts behind the band (back emboss, sleeve film) do not draw over it.
      depthWrite: true,
    });
    // Same base outline as the body's top part, grown by an extra BAND_PROUD all round.
    const bandBase = roundedRect(-W / 2 + r, yBand + r + ob, W / 2 - r, Hbody - r, rc - r, 0.6);
    const band = new THREE.Mesh(roundedSlab(bandBase, T + 2 * ob, r + ob), bandMat);
    band.name = 'band';
    band.castShadow = true;
    root.add(band);

    if (bool(p, 'bandEmboss', true)) {
      // Subtle raised rounded-rectangle frame (no logo/text) centered on the flat band face.
      const capLo = yBand + r + ob + 0.6;
      const capHi = Hbody - r;
      const cy = (capLo + capHi) / 2;
      const ph = Math.min(7.5, (capHi - capLo) * 0.55);
      const pwE = Math.min(66, W * 0.48);
      const ring = roundedRect(-pwE / 2, cy - ph / 2, pwE / 2, cy + ph / 2, ph / 2, ph / 2);
      const inset = 0.9;
      ring.holes.push(
        roundedRect(
          -pwE / 2 + inset,
          cy - ph / 2 + inset,
          pwE / 2 - inset,
          cy + ph / 2 - inset,
          ph / 2 - inset,
          ph / 2 - inset,
        ),
      );
      const emb = new THREE.ExtrudeGeometry(ring, {
        depth: 0.18,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 1,
        curveSegments: 8,
      });
      emb.translate(0, 0, T / 2 + ob - 0.03);
      const embBack = emb.clone().rotateY(Math.PI); // pill is symmetric in x
      const e1 = new THREE.Mesh(emb, bandMat);
      const e2 = new THREE.Mesh(embBack, bandMat);
      e1.name = 'band-emboss-front';
      e2.name = 'band-emboss-back';
      // Drawn after the depth-writing band so the far-side emboss is not seen through it.
      e1.renderOrder = e2.renderOrder = 1;
      root.add(e1, e2);
    }
  }

  // Clear sleeve film + welded edges
  const sheetFrontEndX = sheet[sheet.length - 1].a;
  const filmEndX = Math.min(sheetFrontEndX + 1.0, W / 2 - r - 0.2);
  const fy0 = Math.max(r + 0.1, y0 - 0.8);
  const fy1 = spec.band ? y1 + 0.5 : Math.min(Hbody - r - 0.1, y1 + 0.8);
  const film = new THREE.Mesh(
    ribbon(crossSection(W, T, r, FILM_OFFSET, halfLenTo(W, T, r, FILM_OFFSET, filmEndX)), 'xz', fy0, fy1),
    clearPlastic({ opacity: 0.035 + 0.04 * gloss, roughness: 0.03 + (1 - gloss) * 0.3 }),
  );
  film.name = 'sleeve';
  film.renderOrder = 1;
  root.add(film);

  // Faint frosted lines where the film is welded to the case (top / bottom / open edges).
  const weldOff = FILM_OFFSET + 0.015;
  const weldPath = crossSection(W, T, r, weldOff, halfLenTo(W, T, r, weldOff, filmEndX));
  const wTotal = weldPath[weldPath.length - 1].s;
  const weldW = 0.7;
  const weldGeos: THREE.BufferGeometry[] = [
    ribbon(weldPath, 'xz', fy0, fy0 + weldW),
    ribbon(slicePath(weldPath, wTotal - weldW, wTotal), 'xz', fy0, fy1),
    ribbon(slicePath(weldPath, 0, weldW), 'xz', fy0, fy1),
  ];
  if (!spec.band) weldGeos.push(ribbon(weldPath, 'xz', fy1 - weldW, fy1));
  const weldMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  for (const g of weldGeos) {
    const m = new THREE.Mesh(g, weldMat);
    m.name = 'sleeve-weld';
    m.renderOrder = 2;
    root.add(m);
  }

  // Mold parting line along the top and the open edge
  const seamOff = 0.03;
  const seamHalf = 0.35;
  const seamMat = seamMaterial(plastic);
  const xr = W / 2 - rc;
  const xStart = -W / 2 + r + 0.8; // stops where the spine hinge begins
  const seams: Pt[][] = [];
  if (spec.band) {
    // On the band (which is BAND_PROUD further out) and on the body below it.
    seams.push(openEdgeOutline(xr, Hbody - rc, rc, ob + seamOff, xStart, yBand + r + ob + 0.6));
    seams.push(openEdgeLine(W / 2 + seamOff, yBand, rc));
  } else {
    seams.push(openEdgeOutline(xr, Hbody - rc, rc, seamOff, xStart, rc));
  }
  for (const s of seams) {
    const m = new THREE.Mesh(ribbon(s, 'xy', -seamHalf, seamHalf), seamMat);
    m.name = 'parting-line';
    root.add(m);
  }

  return root;
}
