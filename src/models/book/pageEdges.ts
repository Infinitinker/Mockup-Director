/**
 * The page edges of every book model: a procedural page-line texture made once and kept, the UVs
 * that run its lines parallel to the covers, and the page material.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';

/** Millimeters of page stack covered by one repeat of the page-edge texture (rows run along Z). */
const PAGE_TEX_MM = 12.8;
let pageEdgeTex: THREE.Texture | null = null;

/**
 * Procedural, grayscale page-edge texture: thin horizontal lines (one page ≈ 0.1 mm = 2 rows)
 * with a little random variation. It is a private, module-level texture (never shared with the
 * app, never flagged for disposal) and it is tinted by the material color (page color).
 */
function pageEdgeTexture(): THREE.Texture | null {
  if (pageEdgeTex) return pageEdgeTex;
  if (typeof document === 'undefined') return null;
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(w, h);
  let seed = 0x2f6b1d;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < h; y += 2) {
    // Paper row + a slightly darker "gap" row; now and then a darker / lighter sheet.
    const sheet = 0.93 + rnd() * 0.07 - (rnd() < 0.06 ? 0.06 : 0);
    for (let r = 0; r < 2; r++) {
      const base = r === 0 ? sheet : sheet * 0.9;
      for (let x = 0; x < w; x++) {
        const v = Math.round(255 * clamp(base * (0.985 + rnd() * 0.015), 0, 1));
        const k = ((y + r) * w + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  pageEdgeTex = tex;
  return tex;
}

/**
 * Page block UVs: v follows Z (across the sheets) so the lines run parallel to the covers on
 * every edge face; u only adds a little noise along the edge.
 */
export function pageBlockUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + pos.getY(i)) / 40;
    uv[i * 2 + 1] = pos.getZ(i) / PAGE_TEX_MM;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function pageMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, map: pageEdgeTexture(), roughness: 0.92, metalness: 0 });
}
