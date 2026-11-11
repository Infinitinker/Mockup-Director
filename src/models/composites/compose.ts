/**
 * How a composite model is put together from its base model and a loose 120 mm disc.
 *
 * Slots = the base model's slots + 'disc'; params = base params + discParams + three composition
 * params (discPlacement, discOffset, discAngle). All ids stay identical to the base models, so a
 * designer's artwork drops into the same slots.
 *
 * Build: the base is built exactly as the stand-alone model, its EXACT bounding box is measured
 * and the disc is posed against that box with closed-form math (composites/placement.ts), so it
 * never interpenetrates the case for any param value. Finally the whole group is put on the floor
 * and centered on x/z.
 */
import * as THREE from 'three';
import type {
  ImageSlotDef,
  ModelContext,
  NumberParamDef,
  ParamDef,
  ParamValues,
  SelectParamDef,
} from '../../core/types/model';
import { buildDisc } from '../disc/build';
import { discParams, discSlot } from '../disc/label';
import { num, str } from '../params';
import { discPose, type DiscPlacement } from './placement';

const G_COMP = 'Composition';

const PLACEMENTS: readonly DiscPlacement[] = ['behind', 'front', 'flat'];

const placementParam: SelectParamDef = {
  id: 'discPlacement',
  type: 'select',
  label: 'Disc placement',
  group: G_COMP,
  options: [
    { value: 'behind', label: 'Behind it, peeking out on the right' },
    { value: 'front', label: 'Leaning against the front' },
    { value: 'flat', label: 'Lying flat in front' },
  ],
  default: 'behind',
};

const offsetParam: NumberParamDef = {
  id: 'discOffset',
  type: 'number',
  label: 'Overhang past the right edge',
  group: G_COMP,
  min: 0,
  max: 100,
  step: 1,
  default: 45,
  unit: '%',
};

/** Turn about the vertical axis; + turns the label to the right. Default per model (toward its camera). */
function angleParam(def: number): NumberParamDef {
  return {
    id: 'discAngle',
    type: 'number',
    label: 'Disc turn',
    group: G_COMP,
    min: -45,
    max: 45,
    step: 1,
    default: def,
    unit: 'deg',
  };
}

/**
 * Param ids that a base model must not bring into a composite: the jewel case's own "disc inside"
 * switch (the composite has one loose disc) and disc params (re-added in a fixed position below).
 */
const DROPPED_BASE_PARAMS = new Set(['showDisc', ...discParams.map((d) => d.id)]);

/**
 * Base params + disc params + composition params, in that order. Duplicate ids are skipped
 * (the first definition wins) so a composite can never expose the same id twice.
 */
export function compositeParams(base: ParamDef[], turnDefault: number): ParamDef[] {
  const out: ParamDef[] = [];
  const seen = new Set<string>();
  for (const p of [
    ...base.filter((b) => !DROPPED_BASE_PARAMS.has(b.id)),
    placementParam,
    offsetParam,
    angleParam(turnDefault),
    ...discParams,
  ]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Disc slot of the composites: the stand-alone disc slot (hint without the jewel case's "Disc inside" note). */
const compositeDiscSlot: ImageSlotDef = { ...discSlot };

/** Base slots + the disc slot (an existing 'disc' slot of the base is replaced, never duplicated). */
export function compositeSlots(base: ImageSlotDef[]): ImageSlotDef[] {
  return [...base.filter((s) => s.id !== compositeDiscSlot.id), compositeDiscSlot];
}

/** Context for the base build: same artwork, params with overrides (e.g. no built-in disc). */
export function baseContext(ctx: ModelContext, overrides: ParamValues): ModelContext {
  return {
    getTexture: (slot) => ctx.getTexture(slot),
    hasArtwork: (slot) => ctx.hasArtwork(slot),
    params: { ...ctx.params, ...overrides },
  };
}

/** Exact (vertex-based) world bounding box – Box3 from rotated geometry bboxes would be too big. */
function preciseBounds(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj, true);
}

/**
 * three.js sorts transparent objects by renderOrder FIRST and only then by depth, so the disc's
 * own orders (shell 0, label 2) must be re-based against the case's transparents (keep case
 * 0..2, jewel case shell 10). Otherwise a disc standing BEHIND a translucent case would be drawn
 * after the case plastic and, since that plastic does not write depth, its label would replace
 * the tinted pixels (appearing in front of the plastic). Conversely, a disc in front must be drawn
 * after the case. The relative order inside the disc (shell before label) is preserved; the
 * stage's reflection (-3/-2) and shadow plane (-1) still come first.
 */
function orderDiscTransparents(holder: THREE.Object3D, placement: DiscPlacement): void {
  const behind = placement === 'behind';
  holder.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const isLabel = o.renderOrder >= 2;
    if (behind) o.renderOrder = isLabel ? -0.25 : -0.5;
    else o.renderOrder = isLabel ? 12 : 11;
  });
}

/**
 * Combine a base object (standing on y = 0, front +Z) with a disc posed by the composition params,
 * then put the result on the floor, centered on x/z.
 */
export function compose(ctx: ModelContext, base: THREE.Object3D): THREE.Object3D {
  const p = ctx.params;
  const placementValue = str(p, 'discPlacement', placementParam.default);
  const placement: DiscPlacement = (PLACEMENTS as readonly string[]).includes(placementValue)
    ? (placementValue as DiscPlacement)
    : 'behind';
  const overhang = THREE.MathUtils.clamp(num(p, 'discOffset', offsetParam.default), 0, 100) / 100;
  const turn = THREE.MathUtils.clamp(num(p, 'discAngle', 0), -45, 45);

  const content = new THREE.Group();
  content.name = 'composition';
  content.add(base);

  const caseBounds = preciseBounds(base);
  const pose = discPose(caseBounds, placement, overhang, turn);
  const holder = new THREE.Group();
  holder.name = 'disc-holder';
  holder.position.copy(pose.position);
  holder.quaternion.copy(pose.quaternion);
  holder.add(buildDisc(ctx, compositeDiscSlot.id)); // buildDisc marks its meshes castShadow
  orderDiscTransparents(holder, placement);
  content.add(holder);

  // Floor + center with exact vertex bounds (the tilted disc's geometry bbox would float the case).
  const all = preciseBounds(content);
  if (!all.isEmpty()) {
    const c = all.getCenter(new THREE.Vector3());
    content.position.set(-c.x, -all.min.y, -c.z);
  }

  const root = new THREE.Group();
  root.name = 'composite-root';
  root.add(content);
  return root;
}
