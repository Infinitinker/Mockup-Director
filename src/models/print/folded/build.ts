/**
 * Builds a folded print item from its configuration: the paper parameters, the faces (the
 * placeholder only on the front cover while 'outside' is empty, plain paper on an empty 'inside'),
 * the hinged sheet in its pose, and the item on the floor (y = 0, centered on x/z, the front cover
 * facing +Z, turned slightly toward the camera for open poses).
 */
import * as THREE from 'three';
import type { ModelContext, ParamDef, ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { castShadows, placeOnGround } from '../../geometry';
import { num, str } from '../../params';
import { G_MAT } from '../common';
import { type Finish, type FinishDef, finishOf, PAPER_FINISH, printedMat, solidMat } from '../finishes';
import { buildSheet, type FaceSpec, type FoldSpec, type UVFn } from './hingedSheet';
import { orientSheet, type PoseSpec } from './pose';

/** Cut edge of the paper – slightly darker than the face ; its own values, not those of the flat models' edgeMat. */
function edgeMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.9),
    roughness: 0.92,
    metalness: 0,
  });
}

interface FoldedConfig {
  widths: number[];
  height: number;
  base: number;
  folds: FoldSpec[];
  pose: PoseSpec;
  outUV: UVFn;
  inUV: UVFn;
  thickness: number;
  finish: FinishDef;
  paperColor: string;
  /** Aspect of the 'outside' slot (= its placeholder texture). */
  outsideAspect: number;
}

/**
 * Placeholder mapping for the front panel only (used while the 'outside' slot is empty): the
 * front's slice of the sheet mapping is renormalized to 0..1 (keeping its orientation, so the
 * placeholder is upright on the front) and the whole placeholder is fitted inside ("contain");
 * the rest of the panel shows the clamped edge color of the placeholder gradient.
 */
function placeholderUV(sheetUV: UVFn, X0: number, X1: number, H: number, imgAspect: number): UVFn {
  const c = [sheetUV(X0, 0), sheetUV(X1, 0), sheetUV(X0, H), sheetUV(X1, H)];
  const us = c.map((p) => p[0]);
  const vs = c.map((p) => p[1]);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  // Does u run along the sheet's X (panel width) or along Y?
  const d = c[1];
  const uAlongX = Math.abs(d[0] - c[0][0]) > Math.abs(d[1] - c[0][1]);
  const uMm = uAlongX ? X1 - X0 : H;
  const vMm = uAlongX ? H : X1 - X0;
  const pa = uMm / vMm;
  const ia = Math.max(0.05, imgAspect);
  return (X, Y) => {
    const [u, v] = sheetUV(X, Y);
    let su = (u - u0) / (u1 - u0 || 1);
    let sv = (v - v0) / (v1 - v0 || 1);
    if (pa < ia) sv = 0.5 + (sv - 0.5) * (ia / pa);
    else su = 0.5 + (su - 0.5) * (pa / ia);
    return [su, sv];
  };
}

/**
 * Builds a folded print item: placeholder only on the front cover when 'outside' is empty,
 * plain paper on an empty 'inside'. Result is on the ground, casting shadows.
 */
export function buildFolded(ctx: ModelContext, cfg: FoldedConfig, name: string): THREE.Object3D {
  const f = cfg.finish;
  const solid = solidMat(cfg.paperColor, f);
  const n = cfg.widths.length;
  const x0: number[] = [];
  let acc = 0;
  for (const w of cfg.widths) {
    x0.push(acc);
    acc += w;
  }

  const outside: FaceSpec[] = [];
  if (ctx.hasArtwork('outside')) {
    const mat = printedMat(ctx.getTexture('outside'), f);
    for (let i = 0; i < n; i++) outside.push({ mat, uv: cfg.outUV });
  } else {
    const fr = cfg.pose.front;
    const ph = printedMat(ctx.getTexture('outside'), f);
    const phUV = placeholderUV(cfg.outUV, x0[fr], x0[fr] + cfg.widths[fr], cfg.height, cfg.outsideAspect);
    for (let i = 0; i < n; i++) outside.push(i === fr ? { mat: ph, uv: phUV } : { mat: solid, uv: cfg.outUV });
  }
  const inside: FaceSpec[] = [];
  const inMat = ctx.hasArtwork('inside') ? printedMat(ctx.getTexture('inside'), f) : solid;
  for (let i = 0; i < n; i++) inside.push({ mat: inMat, uv: cfg.inUV });

  const sheet = buildSheet({
    widths: cfg.widths,
    height: cfg.height,
    thickness: cfg.thickness,
    base: cfg.base,
    folds: cfg.folds,
    outside,
    inside,
    edgeMat: edgeMat(cfg.paperColor),
  });
  orientSheet(sheet, cfg.pose);

  const root = new THREE.Group();
  root.name = name;
  root.add(sheet.root);
  castShadows(root);
  placeOnGround(root);
  return root;
}

export const paperColorParam: ParamDef = {
  id: 'paperColor',
  type: 'color',
  label: 'Paper color (no artwork, edges)',
  group: G_MAT,
  default: '#f6f5f1',
};

/** Reads the common paper params. */
export function paperOf(p: ParamValues, defThickness: number, defFinish: Finish) {
  return {
    thickness: clamp(num(p, 'thickness', defThickness), 0.05, 1),
    finish: finishOf(p, PAPER_FINISH, defFinish),
    paperColor: str(p, 'paperColor', '#f6f5f1'),
  };
}
