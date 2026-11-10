/**
 * The finish of a printed book cover (matte or gloss laminate, satin): its parameter, reading it,
 * and the cover material with artwork or a plain color.
 */
import * as THREE from 'three';
import type { ParamDef, ParamValues } from '../../core/types/model';
import { printMaterial } from '../materials';
import { str } from '../params';

const G_MAT = 'Material';

type Finish = 'matte' | 'satin' | 'gloss';

export function finishOf(params: ParamValues, fallback: Finish): Finish {
  const f = str(params, 'coverFinish', fallback);
  return f === 'matte' || f === 'satin' || f === 'gloss' ? f : fallback;
}

export function finishParam(def: Finish): ParamDef {
  return {
    id: 'coverFinish',
    type: 'select',
    label: 'Cover finish',
    group: G_MAT,
    options: [
      { value: 'matte', label: 'Matte laminate' },
      { value: 'satin', label: 'Satin' },
      { value: 'gloss', label: 'Gloss laminate' },
    ],
    default: def,
  };
}

/** Printed cover surface (laminated paper / card) with the chosen finish. */
export function coverMaterial(
  finish: Finish,
  src: { map: THREE.Texture } | { color: string },
): THREE.MeshPhysicalMaterial {
  const look =
    finish === 'matte'
      ? { roughness: 0.8, gloss: 0, ccr: 0.5 }
      : finish === 'gloss'
        ? { roughness: 0.4, gloss: 1, ccr: 0.06 }
        : { roughness: 0.56, gloss: 0.35, ccr: 0.3 };
  if ('map' in src) {
    const m = printMaterial(src.map, { roughness: look.roughness, gloss: look.gloss });
    m.clearcoatRoughness = look.ccr;
    return m;
  }
  return new THREE.MeshPhysicalMaterial({
    color: src.color,
    roughness: look.roughness,
    metalness: 0,
    clearcoat: look.gloss,
    clearcoatRoughness: look.ccr,
  });
}
