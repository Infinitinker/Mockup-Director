/**
 * Tests the laptop's and the monitor's display in src/models/device/computer/display.ts: the active
 * area from its diagonal, the artwork fitted by UVs, the screen when it is off, and the decal and
 * bezel materials.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ModelContext, ParamValues } from '../../../../src/core/types/model';
import {
  bezelMaterial,
  decal,
  SCREEN_PARAMS,
  screenMesh,
  screenSize,
} from '../../../../src/models/device/computer/display';
import { artworkTexture } from '../../fakeContext';

function context(params: ParamValues, texture: THREE.Texture = artworkTexture(1600, 1000)): ModelContext {
  return { params, getTexture: () => texture, hasArtwork: () => true };
}

/** The UV range of a mesh: [uMin, vMin, uMax, vMax]. */
function uvRange(mesh: THREE.Mesh): number[] {
  const uv = mesh.geometry.getAttribute('uv');
  const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
  const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
  return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)].map((x) => +x.toFixed(6));
}

describe('screenSize', () => {
  it('gives the active area of a diagonal in inches', () => {
    const [w, h] = screenSize(27, 16 / 9);
    expect(w).toBeCloseTo(597.73, 2);
    expect(h).toBeCloseTo(336.22, 2);
    expect(Math.hypot(w, h)).toBeCloseTo(27 * 25.4, 6);
  });
});

describe('screenMesh', () => {
  it('maps the whole artwork when its aspect matches the screen', () => {
    const mesh = screenMesh(context({}), 320, 200, 1, 0);
    expect(mesh.name).toBe('screen');
    expect(uvRange(mesh)).toEqual([0, 0, 1, 1]);
  });

  it('crops the center of wider or taller artwork, or stretches it', () => {
    expect(uvRange(screenMesh(context({}, artworkTexture(2000, 1000)), 320, 200, 1, 0))).toEqual([0.1, 0, 0.9, 1]);
    expect(uvRange(screenMesh(context({}, artworkTexture(1000, 1000)), 320, 200, 1, 0))).toEqual([
      0, 0.1875, 1, 0.8125,
    ]);
    expect(uvRange(screenMesh(context({ fit: 'stretch' }, artworkTexture(2000, 1000)), 320, 200, 1, 0))).toEqual([
      0, 0, 1, 1,
    ]);
  });

  it('reads the size of a video frame first', () => {
    const texture = new THREE.Texture({ videoWidth: 2000, videoHeight: 1000, width: 1600, height: 1000 });
    expect(uvRange(screenMesh(context({}, texture), 320, 200, 1, 0))).toEqual([0.1, 0, 0.9, 1]);
  });

  it('subdivides the plane only when it is bent', () => {
    const flat = screenMesh(context({}), 320, 200, 64, 0);
    const bent = screenMesh(context({}), 320, 200, 64, 1800);
    expect(flat.geometry.getAttribute('position').count).toBe(4);
    expect(bent.geometry.getAttribute('position').count).toBe(130);
  });

  it('lights the artwork by the brightness and keeps the screen over the bezel', () => {
    const texture = artworkTexture(1600, 1000);
    const mat = screenMesh(context({ brightness: 500 }, texture), 320, 200, 1, 0)
      .material as THREE.MeshPhysicalMaterial;
    expect(mat.map).toBe(texture);
    expect(mat.emissiveMap).toBe(texture);
    expect(mat.emissiveIntensity).toBe(2);
    expect(mat.polygonOffsetFactor).toBe(-2);
    expect(mat.roughness).toBe(0.22);
  });

  it('shows a dark panel without the artwork when the screen is off', () => {
    const mesh = screenMesh(
      context({ screenOn: false, screenFinish: 'matte' }, artworkTexture(2000, 1000)),
      320,
      200,
      1,
      0,
    );
    const mat = mesh.material as THREE.MeshPhysicalMaterial;
    expect(mat.map).toBeNull();
    expect(mat.color.getHexString()).toBe(new THREE.Color('#060708').getHexString());
    expect(mat.roughness).toBe(0.62);
    expect(uvRange(mesh)).toEqual([0, 0, 1, 1]);
  });
});

describe('bezelMaterial and decal', () => {
  it('give the bezel the screen finish, one decal level over the body', () => {
    const glossy = bezelMaterial(context({}));
    const matte = bezelMaterial(context({ screenFinish: 'matte' }));
    expect([glossy.roughness, matte.roughness]).toEqual([0.2, 0.6]);
    expect([glossy.polygonOffset, glossy.polygonOffsetFactor, glossy.polygonOffsetUnits]).toEqual([true, -1, -1]);
  });

  it('stacks a decal by its level', () => {
    const mat = decal(new THREE.MeshStandardMaterial(), 3);
    expect([mat.polygonOffset, mat.polygonOffsetFactor, mat.polygonOffsetUnits]).toEqual([true, -3, -3]);
  });
});

describe('SCREEN_PARAMS', () => {
  it('lists the Screen parameters the laptop and the monitor share', () => {
    expect(SCREEN_PARAMS.map((p) => p.id)).toEqual(['screenOn', 'brightness', 'screenFinish', 'fit']);
    expect(SCREEN_PARAMS.every((p) => p.group === 'Screen')).toBe(true);
  });
});
