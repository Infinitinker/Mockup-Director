/**
 * The surface finishes of printed paper and plastic (matte, satin, gloss): the Finish parameter,
 * reading it, and the materials of a printed face, an unprinted face and a cut edge. The flat and
 * the folded print models share the paper finishes, so a leaflet next to a flyer looks consistent.
 */
import * as THREE from 'three';
import type { ParamValues, SelectParamDef } from '../../core/types/model';
import { printMaterial } from '../materials';
import { str } from '../params';
import { G_MAT } from './common';

export type Finish = 'matte' | 'satin' | 'gloss';
export interface FinishDef {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

export const PAPER_FINISH: Record<Finish, FinishDef> = {
  matte: { roughness: 0.86, clearcoat: 0, clearcoatRoughness: 0.5 },
  satin: { roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  gloss: { roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06 },
};

export const PLASTIC_FINISH: Record<Finish, FinishDef> = {
  matte: { roughness: 0.7, clearcoat: 0.15, clearcoatRoughness: 0.6 },
  satin: { roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.22 },
  gloss: { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 },
};

export function finishParam(def: Finish, label: string = 'Finish'): SelectParamDef {
  return {
    id: 'finish',
    type: 'select',
    label,
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss' },
    ],
    default: def,
  };
}

export function finishOf(params: ParamValues, table: Record<Finish, FinishDef>, def: Finish): FinishDef {
  const v = str(params, 'finish', def);
  return v === 'matte' || v === 'satin' || v === 'gloss' ? table[v] : table[def];
}

/** Printed face (user artwork / placeholder). */
export function printedMat(map: THREE.Texture, f: FinishDef): THREE.MeshPhysicalMaterial {
  const m = printMaterial(map, { roughness: f.roughness, gloss: f.clearcoat });
  m.clearcoatRoughness = f.clearcoatRoughness;
  return m;
}

/** Unprinted face (empty secondary slot) in the stock color with the same finish. */
export function solidMat(color: string, f: FinishDef): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: f.roughness,
    metalness: 0,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
  });
}

/** Cut edge of paper / board / plastic core – slightly darker than the face (the folded models use their own, in folded/build.ts). */
export function edgeMat(color: string, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.92),
    roughness,
    metalness: 0,
  });
}
