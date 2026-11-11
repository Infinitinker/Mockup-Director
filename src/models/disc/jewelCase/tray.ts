/**
 * The CD tray: its plastic in four colors and its geometry (the block, the rim with the disc recess
 * and the center rosette).
 */
import * as THREE from 'three';
import { clearPlastic, solidPlastic } from '../../materials';
import { CX, CY, type Layout } from './layout';
import { boxGeo, cornerShape } from './shapes';

export function trayMaterial(color: string): THREE.MeshPhysicalMaterial {
  switch (color) {
    case 'clear':
      return clearPlastic({ tint: '#eef4f4', opacity: 0.18, roughness: 0.05 });
    case 'white':
      return solidPlastic('#ecebe6', 0.4);
    case 'smoke':
      return new THREE.MeshPhysicalMaterial({
        color: '#262a30',
        transparent: true,
        opacity: 0.62,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    default:
      return solidPlastic('#141518', 0.42);
  }
}

/**
 * CD tray: solid block up to the recess floor, a rim with the Ø 121.2 disc recess, and the
 * center rosette (hub ring + teeth that grip the 15 mm hole).
 */
export function buildTray(
  mat: THREE.Material,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  lay: Layout,
  transparentOrder: number,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tray';
  const add = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = transparentOrder;
    g.add(m);
  };
  add(boxGeo(x0, x1, y0, y1, lay.trayBack, lay.trayFloor));

  const rimShape = cornerShape(x0, x1, y0, y1, [0.6, 0.6, 0.6, 0.6]);
  const hole = new THREE.Path();
  hole.absarc(CX, CY, 60.6, 0, Math.PI * 2, true);
  rimShape.holes.push(hole);
  const rim = new THREE.ExtrudeGeometry(rimShape, {
    depth: lay.trayFront - lay.trayFloor,
    bevelEnabled: false,
    curveSegments: 96,
  });
  rim.translate(0, 0, lay.trayFloor);
  add(rim);

  // Rosette: ring the disc rests on (clamping area) + 10 teeth.
  const ring = new THREE.CylinderGeometry(12, 12, lay.hubH, 64);
  ring.rotateX(Math.PI / 2);
  ring.translate(CX, CY, lay.trayFloor + lay.hubH / 2);
  add(ring);
  const toothTop = lay.trayFloor + lay.hubH + 1.15; // just below the top of a seated disc
  const toothH = toothTop - lay.trayFloor;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const t = new THREE.BoxGeometry(1.3, 2.3, toothH);
    t.rotateZ(a);
    t.translate(CX + 6.5 * Math.cos(a), CY + 6.5 * Math.sin(a), lay.trayFloor + toothH / 2);
    add(t);
  }
  return g;
}
