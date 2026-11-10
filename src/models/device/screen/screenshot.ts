/**
 * The screenshot model ('device-screenshot'): a thin floating panel showing the user's screenshot,
 * flat or bent into a cylinder around the vertical axis, with an optional thin frame.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, FRONT faces +Z. The panel is
 * built flat in its own frame (centered on x/y, front surface on z = 0, back on z = -thickness),
 * then optionally BENT and finally tilted back and put on the ground.
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
import { commonParams, finishParams, G_MAT, widthParam } from './paramDefs';
import { DEFAULT_ASPECT, imageAspect, screenSlot } from './slot';

/** How far the screen overlay stands proud of a framed front face, mm. */
const OVERLAY_OFFSET = 0.05;

const G_FRAME = 'Frame';

const FRAME_COLORS: Record<string, string> = { light: '#eeeef0', dark: '#131315' };

function buildScreenshot(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const W = clamp(num(p, 'width', 300), 40, 2000);
  const t = clamp(num(p, 'thickness', 2), 0.5, 10);
  const frame = str(p, 'frame', 'none');
  const hasFrame = frame === 'light' || frame === 'dark';
  const finish = finishOf(p);
  const glow = clamp(num(p, 'glow', 80), 0, 200) / 100;
  const aspect = imageAspect(ctx, 'screen', DEFAULT_ASPECT);

  // Border around the image: the frame, or (no frame) just the rounded-edge inset.
  const eBase = Math.min(t / 2, EDGE_ROUND_MAX);
  const f = hasFrame ? clamp(num(p, 'frameWidth', 6), eBase + 0.3, W * 0.25) : 0;
  const heightFor = (border: number) => (W - 2 * border) / aspect + 2 * border;
  const r0 = clamp(num(p, 'cornerRadius', 6), 0, Math.min(W, heightFor(hasFrame ? f : eBase)) / 2 - 0.01);
  const e = Math.min(eBase, r0);
  const H = heightFor(hasFrame ? f : e);
  const r = Math.min(r0, H / 2 - 0.01);
  const { rho, midSegs } = bendOf(W, num(p, 'curvature', 0));
  const d: PanelDims = { W, H, t, r, e, rho, midSegs };

  const bodyColor = hasFrame ? FRAME_COLORS[frame] : str(p, 'bodyColor', '#2a2b2f');
  const bodyMat = bodyMaterial(bodyColor, str(p, 'bodyFinish', 'plastic'));
  const frameMat = hasFrame
    ? new THREE.MeshPhysicalMaterial({
        color: FRAME_COLORS[frame],
        roughness: 0.3,
        clearcoat: 0.8,
        clearcoatRoughness: 0.05,
      })
    : null;

  const panel = new THREE.Group();
  panel.name = 'screenshot-panel';
  addBody(panel, d, bodyMat, frameMat);

  // Screen face: the whole flat front (no frame) or the opening inside the frame (slightly proud).
  // UVs span exactly the image rectangle: u left -> right, v bottom -> top seen from +Z, so the
  // screenshot is upright and not mirrored; the rounded corners just crop the image corners.
  const hw = hasFrame ? W / 2 - f : W / 2 - e;
  const hh = hasFrame ? H / 2 - f : H / 2 - e;
  const rc = Math.max(0, r - (hasFrame ? f : e));
  const xs = columnXs(hw, rc, midSegs);
  const screenGeo = faceStrip(
    xs,
    (x) => hh - cornerDrop(x, hw, rc),
    (x) => -hh + cornerDrop(x, hw, rc),
    hasFrame ? OVERLAY_OFFSET : 0,
    1,
    [-hw, -hh, hw, hh],
  );
  bendGeometry(screenGeo, rho);
  const screenMat = artMaterial(ctx.getTexture('screen'), finish, glow);
  if (hasFrame) {
    // The screen lies over the frame face (0.05 mm proud); polygonOffset keeps it on top even with
    // a far-away / tele camera where 0.05 mm approaches the depth-buffer resolution.
    screenMat.polygonOffset = true;
    screenMat.polygonOffsetFactor = -1;
    screenMat.polygonOffsetUnits = -1;
  }
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.name = 'screen';
  panel.add(screen);

  return finishPanel(panel, num(p, 'tilt', 0));
}

const ICON_SCREENSHOT = icon(
  '<rect x="7" y="12" width="50" height="33" rx="3.5"/><path d="M7 38l13-11 10 8 8-6 19 14"/>' +
    '<circle cx="42" cy="21" r="3"/><path d="M17 53h30"/>',
);

export const screenshotModel: ModelDefinition = {
  id: 'device-screenshot',
  category: 'device',
  name: 'Screenshot',
  description:
    'A thin floating panel showing a screenshot, flat or curved, with an optional frame and a height that follows the artwork.',
  icon: ICON_SCREENSHOT,
  slots: [
    screenSlot(
      'A screenshot or any other artwork, in any aspect ratio: the panel height follows it. Without artwork the panel is 16:10.',
    ),
  ],
  params: [
    widthParam(300),
    ...commonParams(6),
    {
      id: 'frame',
      type: 'select',
      label: 'Frame',
      group: G_FRAME,
      options: [
        { value: 'none', label: 'None' },
        { value: 'light', label: 'Thin light' },
        { value: 'dark', label: 'Thin dark' },
      ],
      default: 'none',
    },
    {
      id: 'frameWidth',
      type: 'number',
      label: 'Frame width',
      group: G_FRAME,
      min: 1,
      max: 40,
      step: 0.5,
      default: 6,
      unit: 'mm',
    },
    ...finishParams(),
    {
      id: 'bodyColor',
      type: 'color',
      label: 'Edge & back color (no frame)',
      group: G_MAT,
      default: '#2a2b2f',
    },
  ],
  defaultCamera: { yaw: 24, pitch: 8 },
  build: buildScreenshot,
};
