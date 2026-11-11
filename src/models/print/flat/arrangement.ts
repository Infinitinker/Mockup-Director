/**
 * How flat print items lie on the floor: the Arrangement parameter (saved as 'layout': lying flat,
 * leaning, a stack, a front-and-back pair), arranging items built standing (lying flat is a
 * rotation of -90° about X, so the front faces up and the artwork's top points away from the
 * camera), and the final naming, shadows and grounding with placeOnGround().
 */
import * as THREE from 'three';
import type { NumberParamDef, ParamValues, SelectParamDef } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { castShadows, placeOnGround } from '../../geometry';
import { str } from '../../params';
import { G_LAY } from '../common';

const deg = THREE.MathUtils.degToRad;

/** Small deterministic PRNG (mulberry32) – stacks must look identical on every rebuild. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An arrangement: the saved values of the 'layout' parameter. */
export type Layout = 'flat' | 'leaning' | 'stack' | 'pair';

const LAYOUT_OPTIONS: Record<Layout, { value: Layout; label: string }> = {
  flat: { value: 'flat', label: 'Lying flat' },
  leaning: { value: 'leaning', label: 'Standing, leaning slightly' },
  stack: { value: 'stack', label: 'Small stack' },
  pair: { value: 'pair', label: 'Two: front and back' },
};

export function layoutParam(kinds: Layout[], def: Layout): SelectParamDef {
  return {
    id: 'layout',
    type: 'select',
    label: 'Arrangement',
    group: G_LAY,
    options: kinds.map((k) => LAYOUT_OPTIONS[k]),
    default: def,
  };
}

export const stackCountParam: NumberParamDef = {
  id: 'stackCount',
  type: 'number',
  label: 'Cards in the stack',
  group: G_LAY,
  min: 2,
  max: 12,
  step: 1,
  default: 6,
  unit: '',
};

export function layoutOf(params: ParamValues, kinds: Layout[], def: Layout): Layout {
  const v = str(params, 'layout', def);
  return (kinds as string[]).includes(v) ? (v as Layout) : def;
}

/** The arrangements of the cards (business card, plastic card). */
export const CARD_LAYOUTS: Layout[] = ['flat', 'leaning', 'stack', 'pair'];

/** Backwards lean of the "standing" layout. */
const LEAN = deg(12);

/**
 * Arrange items built by `make()` (standing frame: front +Z, centered, w x h x t).
 *  flat    – one item, front up, artwork top pointing away (-Z).
 *  leaning – one item standing on its bottom edge, leaning back by LEAN.
 *  stack   – `count` items lying on top of each other with tiny deterministic offsets / turns
 *            (the top one is perfectly square so its artwork reads cleanly).
 *  pair    – two items lying side by side: left shows the front, right is turned over (around its
 *            vertical axis, like a page) and shows the back – upright and not mirrored.
 */
export function arrange(
  make: () => THREE.Object3D,
  layout: Layout,
  w: number,
  h: number,
  t: number,
  count: number,
): THREE.Group {
  const root = new THREE.Group();
  const lay = (flipped: boolean) => {
    const flip = new THREE.Group();
    flip.add(make());
    if (flipped) flip.rotation.y = Math.PI;
    const flat = new THREE.Group();
    flat.rotation.x = -Math.PI / 2; // front (+Z) -> up (+Y), artwork top (+Y) -> away (-Z)
    flat.add(flip);
    const place = new THREE.Group();
    place.add(flat);
    // Ground every item on its own: a bent sheet turned over rests on its two ends (its middle is
    // higher), so grounding only the whole group would leave the other item floating in the air.
    place.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(place);
    if (!box.isEmpty()) flat.position.y = -box.min.y;
    return place;
  };
  switch (layout) {
    case 'leaning': {
      const g = new THREE.Group();
      g.add(make());
      g.rotation.x = -LEAN; // top moves toward -Z
      root.add(g);
      break;
    }
    case 'stack': {
      const rnd = mulberry32(0x5eed1234);
      const n = clamp(Math.round(count), 2, 12);
      const jitter = clamp(0.015 * Math.max(w, h), 0.4, 1.8);
      for (let i = 0; i < n; i++) {
        const p = lay(false);
        const dx = (rnd() * 2 - 1) * jitter;
        const dz = (rnd() * 2 - 1) * jitter;
        const turn = (rnd() * 2 - 1) * deg(2.5);
        if (i < n - 1) {
          p.position.x = dx;
          p.position.z = dz;
          p.rotation.y = turn;
        }
        p.position.y = i * t;
        root.add(p);
      }
      break;
    }
    case 'pair': {
      // Center distance large enough that the two turned items can never overlap: each reaches
      // (w/2)·cos θ + (h/2)·sin θ toward the other one, plus a visible gap.
      const ra = deg(4);
      const rb = deg(6);
      const d =
        (w / 2) * (Math.cos(ra) + Math.cos(rb)) + (h / 2) * (Math.sin(ra) + Math.sin(rb)) + Math.max(6, 0.06 * w);
      const a = lay(false);
      a.position.set(-d / 2, 0, -0.04 * h);
      a.rotation.y = ra;
      const b = lay(true);
      b.position.set(d / 2, 0, 0.05 * h);
      b.rotation.y = -rb;
      root.add(a, b);
      break;
    }
    default:
      root.add(lay(false));
  }
  return root;
}

/** Final touches shared by every model. */
export function finishRoot(root: THREE.Object3D, name: string): THREE.Object3D {
  root.name = name;
  castShadows(root);
  return placeOnGround(root);
}
