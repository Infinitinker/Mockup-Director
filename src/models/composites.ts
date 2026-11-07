/**
 * Composite models: a case or box together with a loose 120 mm disc, as in typical retail
 * boxshots.
 *
 *  - 'box-disc'          product box (buildBox)                 + disc
 *  - 'dvd-case-disc'     DVD keep case (buildKeepCase 'dvd')    + disc
 *  - 'bluray-case-disc'  Blu-ray keep case ('bluray')           + disc
 *  - 'cd-case-disc'      CD jewel case (buildJewelCase)         + disc
 *
 * Slots = the base model's slots + 'disc'; params = base params + discParams + three composition
 * params (discPlacement, discOffset, discAngle). All ids stay identical to the base models, so a
 * designer's artwork drops into the same slots.
 *
 * Build: the base is built exactly as the stand-alone model, its EXACT bounding box is measured
 * and the disc is posed against that box with closed-form maths (composites/placement.ts), so it
 * never interpenetrates the case for any param value. Finally the whole group is put on the floor
 * and centred on x/z.
 */
import * as THREE from 'three';
import type { ImageSlotDef, ModelContext, ModelDefinition, NumberParamDef, ParamDef, ParamValues, SelectParamDef } from '../core/types';
import { L, num, str } from './shared';
import { buildBox, boxModel } from './box';
import { blurayModel, buildKeepCase, dvdModel } from './keepcase';
import { buildJewelCase, cdCaseModel } from './jewelcase';
import { buildDisc, discParams, discSlot } from './disc';
import { discPose, type DiscPlacement } from './composites/placement';

/* ------------------------------------------------------------------ */
/* Composition params                                                  */
/* ------------------------------------------------------------------ */

const G_COMP = L('Composition');

const PLACEMENTS: readonly DiscPlacement[] = ['behind', 'front', 'flat'];

const placementParam: SelectParamDef = {
  id: 'discPlacement',
  type: 'select',
  label: L('Disc placement'),
  group: G_COMP,
  options: [
    { value: 'behind', label: L('Behind the case, peeking out on the right') },
    { value: 'front', label: L('Leaning against the front') },
    { value: 'flat', label: L('Lying flat in front') },
  ],
  default: 'behind',
};

const offsetParam: NumberParamDef = {
  id: 'discOffset',
  type: 'number',
  label: L('Overhang past the right edge'),
  group: G_COMP,
  min: 0,
  max: 100,
  step: 1,
  default: 45,
  unit: '%',
};

/** Turn about the vertical axis; + turns the label to the right. Default per model (towards its camera). */
function angleParam(def: number): NumberParamDef {
  return {
    id: 'discAngle',
    type: 'number',
    label: L('Disc turn'),
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
function compositeParams(base: ParamDef[], turnDefault: number): ParamDef[] {
  const out: ParamDef[] = [];
  const seen = new Set<string>();
  for (const p of [...base.filter((b) => !DROPPED_BASE_PARAMS.has(b.id)), placementParam, offsetParam, angleParam(turnDefault), ...discParams]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Disc slot of the composites: the stand-alone disc slot (hint without the jewel case's "Disc inside" note). */
const compositeDiscSlot: ImageSlotDef = { ...discSlot };

/** Base slots + the disc slot (an existing 'disc' slot of the base is replaced, never duplicated). */
function compositeSlots(base: ImageSlotDef[]): ImageSlotDef[] {
  return [...base.filter((s) => s.id !== compositeDiscSlot.id), compositeDiscSlot];
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/** Context for the base build: same images, params with overrides (e.g. no built-in disc). */
function baseContext(ctx: ModelContext, overrides: ParamValues): ModelContext {
  return {
    getTexture: (slot) => ctx.getTexture(slot),
    hasImage: (slot) => ctx.hasImage(slot),
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
 * then put the result on the floor, centred on x/z.
 */
function compose(ctx: ModelContext, base: THREE.Object3D): THREE.Object3D {
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

  // Floor + centre with exact vertex bounds (the tilted disc's geometry bbox would float the case).
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

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * Line-art icons (64x64, currentColor): the base object with a disc standing behind it and
 * peeking out on the right. Only the visible part of the disc is drawn – the arc end points are
 * the exact intersections of the disc circle with the case outline.
 */
function icon(body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" ' +
    'stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    '</svg>'
  );
}

// Box: disc circle (47, 36) r 13 meets the box's right edge x = 41 at y 24.47 and its slanted
// lower-back edge at (40.65, 47.35).
const ICON_BOX_DISC = icon(
  '<path d="M41 24.47A13 13 0 1 1 40.65 47.35"/><circle cx="47" cy="36" r="3"/>' +
    '<path d="M8 20H32V56H8Z"/><path d="M8 20L17 11H41L32 20"/><path d="M32 56L41 47V11"/>',
);

// DVD: disc circle (46, 39) r 15 meets the case's right edge x = 40 at y 25.25 / 52.75.
const ICON_DVD_DISC = icon(
  '<path d="M40 25.25A15 15 0 1 1 40 52.75"/><circle cx="46" cy="39" r="3"/>' +
    '<rect x="8" y="6" width="32" height="52" rx="4"/><path d="M14 6V58"/>',
);

// Blu-ray: disc circle (46, 39.5) r 15 meets x = 40 at y 25.75 / 53.25; band line at the top.
const ICON_BLURAY_DISC = icon(
  '<path d="M40 25.75A15 15 0 1 1 40 53.25"/><circle cx="46" cy="39.5" r="3"/>' +
    '<rect x="8" y="9" width="32" height="49" rx="4"/><path d="M8 19H40"/><path d="M14 19V58"/><path d="M19 14H31"/>',
);

// CD: disc circle (45, 35.5) r 14.5 meets the case's right edge x = 38 at y 22.8 / 48.2.
const ICON_CD_DISC = icon(
  '<path d="M38 22.8A14.5 14.5 0 1 1 38 48.2"/><circle cx="45" cy="35.5" r="3"/>' +
    '<rect x="4" y="21" width="34" height="30" rx="2.5"/><path d="M9 21V51"/><rect x="12" y="24" width="23" height="24" rx="1"/>',
);

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

export const boxDiscModel: ModelDefinition = {
  id: 'box-disc',
  category: 'box',
  name: L('Box with disc'),
  description: L('Product box with a disc standing behind it, leaning against the front or lying in front.'),
  icon: ICON_BOX_DISC,
  slots: compositeSlots(boxModel.slots),
  params: compositeParams(boxModel.params, 15),
  defaultCamera: { yaw: 30, pitch: 12 },
  build: (ctx) => compose(ctx, buildBox(ctx)),
};

export const dvdDiscModel: ModelDefinition = {
  id: 'dvd-case-disc',
  category: 'disc',
  name: L('DVD case with disc'),
  description: L('DVD keep case with a disc peeking out from behind, leaning against the front or lying in front.'),
  icon: ICON_DVD_DISC,
  slots: compositeSlots(dvdModel.slots),
  // The keep-case camera looks from the front-left (printed spine): turn the label that way too.
  params: compositeParams(dvdModel.params, -12),
  defaultCamera: { yaw: -30, pitch: 12 },
  build: (ctx) => compose(ctx, buildKeepCase(ctx, 'dvd')),
};

export const blurayDiscModel: ModelDefinition = {
  id: 'bluray-case-disc',
  category: 'disc',
  name: L('Blu-ray case with disc'),
  description: L('Blu-ray keep case with a disc peeking out from behind, leaning against the front or lying in front.'),
  icon: ICON_BLURAY_DISC,
  slots: compositeSlots(blurayModel.slots),
  params: compositeParams(blurayModel.params, -12),
  defaultCamera: { yaw: -30, pitch: 12 },
  build: (ctx) => compose(ctx, buildKeepCase(ctx, 'bluray')),
};

export const cdDiscModel: ModelDefinition = {
  id: 'cd-case-disc',
  category: 'disc',
  name: L('CD case with disc'),
  description: L('CD jewel case with a disc peeking out from behind, leaning against the front or lying in front.'),
  icon: ICON_CD_DISC,
  slots: compositeSlots(cdCaseModel.slots),
  params: compositeParams(cdCaseModel.params, 15),
  defaultCamera: { yaw: 30, pitch: 10, fov: 24 },
  // The loose disc replaces the jewel case's own "disc inside" (one 'disc' slot, one disc).
  build: (ctx) => compose(ctx, buildJewelCase(baseContext(ctx, { showDisc: false }))),
};

/** "Box with disc", "DVD case with disc", "Blu-ray case with disc", "CD case with disc". */
export const compositeModels: ModelDefinition[] = [boxDiscModel, dvdDiscModel, blurayDiscModel, cdDiscModel];
