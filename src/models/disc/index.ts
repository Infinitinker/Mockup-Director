/**
 * The Disc model ('disc'): one 120 mm disc with printed label, clear hub and rainbow data side,
 * standing, leaning or lying, with its label turned.
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition } from '../../core/types/model';
import { icon } from '../icon';
import { num, str } from '../params';
import { buildDisc } from './build';
import { discParams, discSlot } from './label';

/** Tilt of the label normal from vertical (deg) per pose: 0 = lying flat, 90 = standing upright. */
const POSE_TILT: Record<string, number> = { tilted: 72, upright: 90, flat: 0, leaning: 50 };

/** Ground placement using exact vertex bounds (a spun disc's bbox corners would float it). */
function placeOnGroundPrecise(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y;
}

function buildDiscModel(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const tilt = POSE_TILT[str(p, 'pose', 'tilted')] ?? POSE_TILT.tilted;

  const spin = new THREE.Group();
  spin.rotation.y = THREE.MathUtils.degToRad(num(p, 'spin', 0));
  spin.add(buildDisc(ctx, 'disc'));

  // rotateX(+θ) tips the label normal from +Y toward +Z (the camera) and keeps the artwork's
  // top edge pointing up (image top lies toward -Z when flat, which rotates to +Y).
  const pose = new THREE.Group();
  pose.rotation.x = THREE.MathUtils.degToRad(tilt);
  pose.add(spin);

  const root = new THREE.Group();
  root.name = 'disc-model';
  root.add(pose);
  placeOnGroundPrecise(pose);
  return root;
}

const G_POSE = 'Pose';

export const discModel: ModelDefinition = {
  id: 'disc',
  category: 'disc',
  name: 'Disc',
  description: '120 mm disc with printed label, clear hub and rainbow data side.',
  icon: icon(
    '<circle cx="32" cy="32" r="25"/><circle cx="32" cy="32" r="9"/><circle cx="32" cy="32" r="3.5"/>' +
      '<path d="M32 14.5A17.5 17.5 0 0 1 49.5 32"/>',
    2.5,
  ),
  slots: [discSlot],
  params: [
    {
      id: 'pose',
      type: 'select',
      label: 'Disc pose',
      group: G_POSE,
      options: [
        { value: 'tilted', label: 'Standing, slightly tilted' },
        { value: 'upright', label: 'Standing upright' },
        { value: 'leaning', label: 'Leaning at an angle' },
        { value: 'flat', label: 'Lying flat' },
      ],
      default: 'tilted',
    },
    {
      id: 'spin',
      type: 'number',
      label: 'Label rotation',
      group: G_POSE,
      min: -180,
      max: 180,
      step: 1,
      default: 0,
      unit: 'deg',
    },
    ...discParams,
  ],
  defaultCamera: { yaw: -15, pitch: 16, fov: 24 },
  build: buildDiscModel,
};
