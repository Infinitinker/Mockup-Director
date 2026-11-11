/**
 * The wire of a spiral notebook: a double loop wire (one ring pair per hole) or one continuous
 * single coil, and the wire's material.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../core/math';
import { holeCenter, type NoteGeom } from './notebookLayout';

const PI = Math.PI;

/** Wire colors: bare metal or powder-coated. */
export function coilMaterial(color: string): THREE.MeshPhysicalMaterial {
  if (color === 'black')
    return new THREE.MeshPhysicalMaterial({
      color: '#1b1b1e',
      metalness: 0.45,
      roughness: 0.32,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
  if (color === 'white')
    return new THREE.MeshPhysicalMaterial({
      color: '#f1f1ef',
      metalness: 0.05,
      roughness: 0.3,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
  return new THREE.MeshPhysicalMaterial({ color: '#d5d8dd', metalness: 1, roughness: 0.26 });
}

/** Parametric curve wrapper (used for the continuous single coil). */
class FnCurve extends THREE.Curve<THREE.Vector3> {
  private readonly fn: (t: number, out: THREE.Vector3) => THREE.Vector3;

  constructor(fn: (t: number, out: THREE.Vector3) => THREE.Vector3) {
    super();
    this.fn = fn;
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    return this.fn(t, optionalTarget);
  }
}

/**
 * The binding wire through the holes of `g`: the merged double loops ('double-loop-wire', or null
 * when they cannot be merged) or the single coil ('coil').
 */
export function buildCoil(g: NoteGeom, material: THREE.Material): THREE.Mesh | null {
  // Ring frame: dIn points from the binding edge into the book, Z is the book's thickness axis.
  // A ring point at angle φ is center + R·cosφ·dIn + R·sinφ·Z; φ = φf is the front hole, φ = π the
  // far side round the edge, φ = 2π - φf the back hole. Center = hole - sOff·dIn.
  const left = g.binding === 'left';
  const dIn = left ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, -1, 0);
  const along = left ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const phiF = Math.atan2(g.Tf, g.sOff);
  const centerAt = (a: number): THREE.Vector3 => {
    const [hx, hy] = holeCenter(g, a);
    return new THREE.Vector3(hx, hy, 0).addScaledVector(dIn, -g.sOff);
  };

  if (g.coil === 'doubleLoop') {
    // Only the visible part of each loop (front hole -> round the edge -> back hole), extended a
    // little so the open tube ends stay hidden under the covers. One geometry shared by all loops.
    const eps = 0.3;
    const arc = 2 * PI - 2 * phiF + 2 * eps;
    const ring = new THREE.TorusGeometry(g.R, g.rw, 6, 24, arc);
    ring.rotateZ(phiF - eps);
    // Proper rotation: local X -> dIn, local Y -> Z, local Z -> dIn × Z.
    ring.applyMatrix4(new THREE.Matrix4().makeBasis(dIn, zAxis, new THREE.Vector3().crossVectors(dIn, zAxis)));
    // All loops merged into ONE mesh (one draw call instead of 2 per hole, also in shadow passes).
    const loops: THREE.BufferGeometry[] = [];
    for (const a of g.positions) {
      for (const side of [-1, 1]) {
        const c = centerAt(a).addScaledVector(along, (side * g.pairGap) / 2);
        loops.push(ring.clone().translate(c.x, c.y, c.z));
      }
    }
    const wire = mergeGeometries(loops);
    loops.forEach((l) => {
      l.dispose();
    });
    ring.dispose();
    if (!wire) return null;
    const m = new THREE.Mesh(wire, material);
    m.name = 'double-loop-wire';
    return m;
  } else {
    // One continuous coil: inside the book (between back and front hole, φ ∈ [-φf, φf]) the wire
    // stays at its hole; on the way round the edge it advances by one pitch to the next hole.
    // φ runs from -π to turns·2π + π: the extra half turn at each end threads the first back hole
    // and the last front hole too and forms the crimped tails that bend round the binding edge
    // (without them one hole at each end would stay empty).
    const turns = g.positions.length - 1;
    const a0 = g.positions[0];
    const base = centerAt(0);
    const phiStart = -PI;
    const phiSpan = turns * 2 * PI + 2 * PI;
    const curve = new FnCurve((t, out) => {
      const phi = phiStart + t * phiSpan;
      const k = clamp(Math.floor(phi / (2 * PI)), 0, turns - 1);
      const psi = phi - k * 2 * PI;
      let f: number;
      if (psi <= phiF) f = 0;
      else if (psi >= 2 * PI - phiF) f = 1;
      else f = (psi - phiF) / (2 * PI - 2 * phiF);
      const a = a0 + (k + f) * g.pitch;
      return out
        .copy(base)
        .addScaledVector(along, a)
        .addScaledVector(dIn, g.R * Math.cos(phi))
        .addScaledVector(zAxis, g.R * Math.sin(phi));
    });
    const segs = (turns + 1) * 32;
    // Dense arc-length table (the default 200 divisions is far too coarse for dozens of turns).
    curve.arcLengthDivisions = segs * 2;
    const tube = new THREE.TubeGeometry(curve, segs, g.rw, 6, false);
    const coil = new THREE.Mesh(tube, material);
    coil.name = 'coil';
    return coil;
  }
}
