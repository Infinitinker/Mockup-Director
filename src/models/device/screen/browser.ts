/**
 * The browser window model ('device-browser'): the screenshot panel with a generic title bar on top
 * (window buttons, back/forward chevrons, address pill with an optional short domain text), flat or
 * curved, built like the screenshot panel (see screenshot.ts).
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { num, str } from '../../params';
import { addBody, EDGE_ROUND_MAX, finishPanel, type PanelDims } from './assembly';
import { bendGeometry, bendOf } from './bend';
import { columnXs, cornerDrop, faceStrip } from './faces';
import { artMaterial, bodyMaterial, finishOf } from './finishes';
import { commonParams, finishParams, widthParam } from './paramDefs';
import { DEFAULT_ASPECT, imageAspect, screenSlot } from './slot';
import { chromeTexture, PALETTES } from './titleBar';

const G_WIN = 'Window';

/** Domain shown in the address pill; 'empty' = blank pill, 'none' = no pill. */
const ADDRESS_OPTIONS = ['example.com', 'www.example.com', 'app.example.com', 'shop.example.com', 'localhost:3000'];

function buildBrowser(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const W = clamp(num(p, 'width', 320), 40, 2000);
  const t = clamp(num(p, 'thickness', 2), 0.5, 10);
  const theme = str(p, 'theme', 'light') === 'dark' ? 'dark' : 'light';
  const pal = PALETTES[theme];
  const finish = finishOf(p);
  const glow = clamp(num(p, 'glow', 80), 0, 200) / 100;
  const aspect = imageAspect(ctx, 'screen', DEFAULT_ASPECT);

  const eBase = Math.min(t / 2, EDGE_ROUND_MAX);
  const barH = clamp(W * 0.045 * (clamp(num(p, 'barScale', 100), 50, 200) / 100), 3, W * 0.2);
  // Content fills the flat front under the bar: width W - 2e, height from the image aspect.
  const contentH0 = (W - 2 * eBase) / aspect;
  let r = clamp(num(p, 'cornerRadius', 4), 0, Math.min(W / 2, eBase + barH, eBase + contentH0 / 2) - 0.01);
  const e = Math.min(eBase, r);
  const contentH = (W - 2 * e) / aspect;
  const H = contentH + barH + 2 * e;
  r = Math.min(r, e + barH, e + contentH / 2);
  const { rho, midSegs } = bendOf(W, num(p, 'curvature', 0));
  const d: PanelDims = { W, H, t, r, e, rho, midSegs };

  const panel = new THREE.Group();
  panel.name = 'browser-window';
  addBody(panel, d, bodyMaterial(pal.body, str(p, 'bodyFinish', 'plastic')), null);

  const hw = W / 2 - e;
  const top = H / 2 - e;
  const bot = -H / 2 + e;
  const split = top - barH;
  const rc = r - e;
  const xs = columnXs(hw, rc, midSegs);

  // Chrome bar (top corners rounded): its canvas covers [-hw, split]..[hw, top]; u left -> right,
  // v bottom -> top seen from +Z -> upright, not mirrored.
  const barGeo = faceStrip(
    xs,
    (x) => top - cornerDrop(x, hw, rc),
    () => split,
    0,
    1,
    [-hw, split, hw, top],
  );
  bendGeometry(barGeo, rho);
  const barTex = chromeTexture(2 * hw, barH, pal, str(p, 'buttons', 'color'), str(p, 'address', 'example.com'));
  const bar = new THREE.Mesh(barGeo, artMaterial(barTex, finish, glow));
  bar.name = 'window-chrome';
  panel.add(bar);

  // Content (bottom corners rounded): the user's image spans [-hw, bot]..[hw, split] exactly,
  // u left -> right, v bottom -> top seen from +Z -> upright, not mirrored.
  const contentGeo = faceStrip(
    xs,
    () => split,
    (x) => bot + cornerDrop(x, hw, rc),
    0,
    1,
    [-hw, bot, hw, split],
  );
  bendGeometry(contentGeo, rho);
  const content = new THREE.Mesh(contentGeo, artMaterial(ctx.getTexture('screen'), finish, glow));
  content.name = 'screen';
  panel.add(content);

  return finishPanel(panel, num(p, 'tilt', 0));
}

const ICON_BROWSER = icon(
  '<rect x="6" y="10" width="52" height="44" rx="4"/><path d="M6 21h52"/>' +
    '<circle cx="12.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="17.5" cy="15.5" r="1.2" fill="currentColor"/>' +
    '<circle cx="22.5" cy="15.5" r="1.2" fill="currentColor"/><rect x="29" y="13.5" width="22" height="4" rx="2"/>',
);

export const browserWindowModel: ModelDefinition = {
  id: 'device-browser',
  category: 'device',
  name: 'Browser window',
  description:
    'A browser or app window with a generic title bar (buttons, address bar), flat or curved, whose height follows the artwork.',
  icon: ICON_BROWSER,
  slots: [
    screenSlot(
      'The window content under the bar, such as a screenshot of a page, in any aspect ratio: the window height follows it. Without artwork the content is 16:10.',
    ),
  ],
  params: [
    widthParam(320),
    ...commonParams(4),
    {
      id: 'theme',
      type: 'select',
      label: 'Bar theme',
      group: G_WIN,
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      default: 'light',
    },
    {
      id: 'buttons',
      type: 'select',
      label: 'Window buttons',
      group: G_WIN,
      options: [
        { value: 'color', label: 'Colored' },
        { value: 'gray', label: 'Gray' },
        { value: 'none', label: 'None' },
      ],
      default: 'color',
    },
    {
      id: 'address',
      type: 'select',
      label: 'Address bar',
      group: G_WIN,
      options: [
        ...ADDRESS_OPTIONS.map((a) => ({ value: a, label: a })),
        { value: 'empty', label: 'Empty' },
        { value: 'none', label: 'None' },
      ],
      default: 'example.com',
    },
    {
      id: 'barScale',
      type: 'number',
      label: 'Bar height',
      group: G_WIN,
      min: 50,
      max: 200,
      step: 5,
      default: 100,
      unit: '%',
    },
    ...finishParams(),
  ],
  defaultCamera: { yaw: 24, pitch: 8 },
  build: buildBrowser,
};
