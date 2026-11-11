/**
 * Tests the binding wire of the spiral notebook in src/models/book/coil.ts: the wire's colors, the
 * double loop wire and the single coil, each wrapping round the binding edge.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCoil, coilMaterial } from '../../../src/models/book/coil';
import { noteGeom } from '../../../src/models/book/notebookLayout';

describe('coilMaterial', () => {
  it('is bare metal unless black or white', () => {
    const silver = coilMaterial('silver');
    expect([silver.color.getHexString(), silver.metalness, silver.roughness, silver.clearcoat]).toEqual([
      'd5d8dd',
      1,
      0.26,
      0,
    ]);
    expect(coilMaterial('gold').color.getHexString()).toBe('d5d8dd');
    const black = coilMaterial('black');
    expect([black.color.getHexString(), black.metalness, black.roughness, black.clearcoat]).toEqual([
      '1b1b1e',
      0.45,
      0.32,
      0.6,
    ]);
    const white = coilMaterial('white');
    expect([white.color.getHexString(), white.metalness, white.roughness, white.clearcoat]).toEqual([
      'f1f1ef',
      0.05,
      0.3,
      0.6,
    ]);
  });
});

describe('buildCoil', () => {
  const material = new THREE.MeshBasicMaterial();

  it.each([
    { coil: 'doubleLoop', name: 'double-loop-wire' },
    { coil: 'spiral', name: 'coil' },
  ])('makes the $coil wire with the given material', ({ coil, name }) => {
    const wire = buildCoil(noteGeom({ coil }), material);
    expect(wire?.name).toBe(name);
    expect(wire?.material).toBe(material);
  });

  it.each(['doubleLoop', 'spiral'])('wraps the %s wire round the left binding edge, through both covers', (coil) => {
    const g = noteGeom({ coil });
    const box = new THREE.Box3().setFromObject(buildCoil(g, material) as THREE.Mesh);
    expect(box.min.x).toBeLessThan(-g.W / 2);
    expect(box.max.x).toBeGreaterThan(-g.W / 2 + g.hd);
    expect(box.min.z).toBeLessThan(-g.Tf);
    expect(box.max.z).toBeGreaterThan(g.Tf);
    const span = g.positions[g.positions.length - 1] - g.positions[0];
    expect(box.max.y - box.min.y).toBeGreaterThan(span);
  });

  it('wraps the wire round the top edge for a top binding', () => {
    const g = noteGeom({ binding: 'top' });
    const box = new THREE.Box3().setFromObject(buildCoil(g, material) as THREE.Mesh);
    expect(box.max.y).toBeGreaterThan(g.H / 2);
    expect(box.min.y).toBeLessThan(g.H / 2 - g.hd);
  });
});
