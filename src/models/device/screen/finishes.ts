/**
 * The finish of the screenshot panel and the browser window: the artwork lit like a screen or
 * printed, matte or glossy, and the material of the edges and the back.
 */
import * as THREE from 'three';
import type { ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { printMaterial } from '../../materials';
import { str } from '../../params';

type Finish = 'screen' | 'screenMatte' | 'printMatte' | 'printGloss';

/**
 * Surface showing the artwork. Screen finishes light the image like a display (map + the same
 * texture as emissiveMap); the diffuse part is dimmed as the glow rises so it does not wash out.
 */
export function artMaterial(map: THREE.Texture, finish: string, glow: number): THREE.MeshPhysicalMaterial {
  if (finish === 'printMatte') return printMaterial(map, { roughness: 0.82 });
  if (finish === 'printGloss') return printMaterial(map, { roughness: 0.38, gloss: 1 });
  const matte = finish === 'screenMatte';
  return new THREE.MeshPhysicalMaterial({
    map,
    color: new THREE.Color().setScalar(clamp(1 - glow * 0.7, 0.15, 1)),
    emissiveMap: map,
    emissive: '#ffffff',
    emissiveIntensity: glow,
    roughness: matte ? 0.6 : 0.16,
    metalness: 0,
    clearcoat: matte ? 0 : 1,
    clearcoatRoughness: 0.04,
  });
}

/** Edges / back / frame. */
export function bodyMaterial(color: THREE.ColorRepresentation, finish: string): THREE.MeshPhysicalMaterial {
  if (finish === 'metal') {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, metalness: 1 });
  }
  const gloss = finish === 'gloss';
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: gloss ? 0.22 : 0.5,
    metalness: 0,
    clearcoat: gloss ? 0.8 : 0.15,
    clearcoatRoughness: gloss ? 0.05 : 0.3,
  });
}

export const finishOf = (p: ParamValues): Finish => {
  const f = str(p, 'finish', 'screen');
  return f === 'screenMatte' || f === 'printMatte' || f === 'printGloss' ? f : 'screen';
};
