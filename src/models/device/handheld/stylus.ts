/** The generic round stylus that can lie in front of the tablet. */
import * as THREE from 'three';

/** Generic round stylus (Ø 8.9 x 166 mm) lying along X, lowest point at y = 0. */
export function buildStylus(dark: boolean): THREE.Object3D {
  const R = 4.45;
  const len = 166;
  const g = new THREE.Group();
  g.name = 'stylus';
  // Lathe profiles: (radius, position along the axis), tip at 0.
  const nib = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.45, 0.12),
    new THREE.Vector2(0.8, 0.9),
    new THREE.Vector2(1.05, 2.6),
  ];
  const body = [
    new THREE.Vector2(1.05, 2.6),
    new THREE.Vector2(2.2, 7),
    new THREE.Vector2(3.5, 12.5),
    new THREE.Vector2(4.25, 17),
    new THREE.Vector2(R, 19.5),
    new THREE.Vector2(R, len - 3),
    new THREE.Vector2(R * 0.92, len - 1.1),
    new THREE.Vector2(R * 0.6, len - 0.25),
    new THREE.Vector2(0, len),
  ];
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: dark ? '#26272a' : '#f1f1ee',
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  const nibMat = new THREE.MeshStandardMaterial({ color: '#e2e2de', roughness: 0.6, metalness: 0 });
  // LatheGeometry revolves around +Y; rotateZ(-90°) maps +Y -> +X, so the tip (axis position 0)
  // ends up at the left end after centering, the cap on the right; the axis is lifted to y = R.
  const toX = (geo: THREE.BufferGeometry) => geo.rotateZ(-Math.PI / 2).translate(-len / 2, R, 0);
  const bodyMesh = new THREE.Mesh(toX(new THREE.LatheGeometry(body, 40)), bodyMat);
  const nibMesh = new THREE.Mesh(toX(new THREE.LatheGeometry(nib, 32)), nibMat);
  bodyMesh.name = 'stylus-body';
  nibMesh.name = 'stylus-nib';
  g.add(bodyMesh, nibMesh);
  return g;
}
