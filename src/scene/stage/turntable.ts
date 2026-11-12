/**
 * The stage's half of a turntable animation, behind StageAPI.beginAnimation(): one fixed framing that fits every
 * frame, a frozen viewport while the frames are rendered, and each frame rendered off-screen. The angles and delays
 * of the frames come from src/export/animation/turntable.ts.
 *
 * Turntable = the CAMERA orbits the vertical axis through the model's center. Because the light
 * rig, the environment rotation and the key-light shadow are all camera-relative, this is exactly
 * what a product turning on a turntable in front of a fixed studio looks like: highlights stay
 * put, the shadow swings around the product consistently and the floor reflection (a mirror
 * about y = 0) is correct in every frame. The model itself is never touched.
 *
 * Framing: every frame is the base view rotated by Ry(-angle) around the pivot, so measuring the
 * point clouds rotated by +angle in the BASE camera's frame gives one fit (UnionFit) that is
 * valid for all frames – the composition is fixed and never cropped.
 */
import * as THREE from 'three';
import type {
  AnimationFramingOptions,
  AnimationRenderSession,
  CameraSettings,
  SceneSettings,
} from '../../core/types/scene';
import { cloneScene } from '../../core/defaults';
import { UserError } from '../../core/errors';
import { finite } from '../../core/math';
import { UnionFit, type FitResult } from '../framing';
import { computeShadowLayout } from '../shadows/layout';
import type { Reflection } from '../reflection';
import type { FitPoints, ModelInfo } from './modelInfo';
import { keyIntensity, keyLightDir } from './lighting';
import { gpuLimits, renderSize, renderTiles } from './tiles';
import { log } from '../../platform/log';

const DEG = Math.PI / 180;

/**
 * Animation: same slack as stills. Animations are NOT cropped to the alpha bounds afterwards (that
 * would make the composition breathe), so the slack also keeps the soft shadow's faint tails in.
 */
const ANIM_SLACK = 1.04;

/** A running animation, as the stage keeps it: the viewport is frozen while it exists. */
export interface AnimationHandle {
  end(): void;
}

/** What the turntable needs from the stage; the functions read the stage's state at the moment they are called. */
export interface TurntableHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly wrapper: HTMLElement;
  readonly reflection: Reflection;
  readonly fitPoints: FitPoints;
  isDisposed(): boolean;
  isContextLost(): boolean;
  settings(): SceneSettings;
  model(): THREE.Object3D | null;
  info(): ModelInfo;
  /** Render the on-screen view right now. */
  frameNow(): void;
  resize(): void;
  /** Forget the pointers down. */
  cancelGestures(): void;
  /** Lights, shadow and reflection for a camera yaw, at the export's shadow resolution. */
  layoutExportEffects(s: SceneSettings, yaw: number, aboveFloor: boolean): void;
  /** Configure (and activate) the camera for a solved framing. */
  applyCamera(
    cam: CameraSettings,
    aspect: number,
    fit: FitResult,
    zoom: number,
  ): THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** The camera applyCamera activated last. */
  activeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** The running animation, if there is one. */
  animation(): AnimationHandle | null;
  setAnimation(handle: AnimationHandle | null): void;
}

/** The angles of the frames: values that are not finite numbers become 0, and no angles become one frame at 0. */
export function animationAngles(angles: unknown): number[] {
  const out = (Array.isArray(angles) ? angles : []).map((a) => finite(a, 0));
  if (!out.length) out.push(0);
  return out;
}

/**
 * One framing for the union of all frames: the model and reflection points `basePts` (fixed in world space) seen at
 * every angle, and with `shadowOn` the key-light shadow of each frame.
 */
export function turntableFit(
  basePts: Float32Array,
  angles: readonly number[],
  snap: SceneSettings,
  info: Pick<ModelInfo, 'bounds' | 'pivot'>,
  aspect: number,
  shadowOn: boolean,
): FitResult {
  const baseCam = snap.camera;
  const key = keyIntensity(snap.light);
  const union = new UnionFit(info.pivot, baseCam, aspect, ANIM_SLACK);
  const dir = new THREE.Vector3();
  const corners = new Float32Array(12);
  const seen = new Set<number>();
  for (const a of angles) {
    const k = Math.round(a * 1e6);
    if (seen.has(k)) continue; // swings repeat every angle twice
    seen.add(k);
    union.add(basePts, a);
    if (shadowOn) {
      // The key-light shadow follows the camera-relative light: its rectangle differs per frame.
      keyLightDir(snap, baseCam.yaw - a, dir);
      const r = computeShadowLayout({
        bounds: info.bounds,
        lightDir: dir,
        softness: snap.shadow.softness,
        keyIntensity: key,
      }).visible;
      corners.set([r.minX, 0, r.minZ, r.maxX, 0, r.minZ, r.minX, 0, r.maxZ, r.maxX, 0, r.maxZ]);
      union.add(corners, a);
    }
  }
  return union.result();
}

/** Start rendering a turntable animation on the stage; it ends any animation that runs. */
export function startAnimation(host: TurntableHost, o: AnimationFramingOptions): AnimationRenderSession {
  if (host.isDisposed() || host.isContextLost())
    throw new UserError('The 3D preview is not available right now. Try again in a moment.');
  host.animation()?.end();

  const { renderer, scene, wrapper, reflection } = host;
  const canvas = renderer.domElement;
  const angles = animationAngles(o.angles);
  const W = Math.max(1, Math.round(finite(o.width, 1)));
  const H = Math.max(1, Math.round(finite(o.height, 1)));
  const { limit, tile } = gpuLimits(renderer);
  const { scale, width: RW, height: RH } = renderSize(W, H, limit);
  const aspect = RW / RH;

  // Snapshot: later UI changes must not leak into a running animation.
  const snap = cloneScene(host.settings());
  const baseCam = snap.camera;
  const startModel = host.model();
  const startInfo = host.info();
  const aboveFloor = baseCam.pitch >= 0;
  const useZoomPan = !!o.useViewZoomPan;

  // One framing for the union of all frames.
  reflection.update(snap.reflection, aboveFloor);
  const reflDepth = reflection.group.visible ? reflection.visibleDepth(snap.reflection) : null;
  // Model + reflection samples are fixed in world space (copy: FitPoints reuses its buffer).
  const basePts = host.fitPoints.build(startInfo.samples, reflDepth, Math.max(0, snap.reflection.gap), null).slice();
  const shadowOn = !!startModel && snap.shadow.enabled && snap.shadow.opacity > 0 && aboveFloor;
  const baseFit = turntableFit(basePts, angles, snap, startInfo, aspect, shadowOn);

  // Freeze the viewport.
  host.frameNow(); // fresh pixels in the drawing buffer – copied below in the same task
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  try {
    overlay.getContext('2d')?.drawImage(canvas, 0, 0);
  } catch (e) {
    // An empty overlay still hides the turntable's frames, only without the last picture.
    log.warn('Cannot copy the 3D view onto the overlay that hides the turntable render', e);
  }
  overlay.className = 'mockup-director-stage-freeze';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    cursor: 'progress',
    touchAction: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  wrapper.appendChild(overlay);
  host.cancelGestures();

  const prevRatio = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());
  // Only needed when the GPU cannot render the requested size (rendered smaller, scaled up).
  let low: HTMLCanvasElement | null = null;
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dq = new THREE.Quaternion();
  let ended = false;

  const end = () => {
    if (ended) return;
    ended = true;
    if (host.animation() === handle) host.setAnimation(null);
    overlay.remove();
    overlay.width = 0;
    overlay.height = 0;
    if (low) {
      low.width = 0;
      low.height = 0;
      low = null;
    }
    if (host.isDisposed()) return;
    host.activeCamera().clearViewOffset();
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    host.resize(); // the viewport may have been resized meanwhile
    host.frameNow();
  };
  const handle: AnimationHandle = { end };
  host.setAnimation(handle);

  return {
    frameCount: angles.length,
    renderFrame(index: number, target: HTMLCanvasElement) {
      if (ended) throw new Error('The animation session has ended.');
      if (host.isDisposed() || host.isContextLost() || host.model() !== startModel) {
        throw new UserError(
          'The model changed or the 3D preview was reset while the animation was being rendered. Export the animation again.',
        );
      }
      const i = THREE.MathUtils.clamp(Math.round(finite(index, 0)), 0, angles.length - 1);
      const a = angles[i];
      if (target.width !== W) target.width = W;
      if (target.height !== H) target.height = H;
      const outCtx = target.getContext('2d');
      if (!outCtx) {
        throw new UserError('Not enough memory for an animation this large. Reduce the size.');
      }
      outCtx.clearRect(0, 0, W, H);
      let ctx = outCtx;
      if (scale < 1) {
        if (!low) {
          low = document.createElement('canvas');
          low.width = RW;
          low.height = RH;
        }
        const lowCtx = low.getContext('2d');
        if (!lowCtx) throw new UserError('Not enough memory for an animation this large. Reduce the size.');
        ctx = lowCtx;
        ctx.clearRect(0, 0, RW, RH);
      }
      try {
        renderer.setPixelRatio(1);
        host.layoutExportEffects(snap, baseCam.yaw - a, aboveFloor);
        // Camera yaw offset = -angle: rotate the base framing around the vertical pivot axis.
        dq.setFromAxisAngle(yAxis, -a * DEG);
        const position = baseFit.position.clone().sub(startInfo.pivot).applyQuaternion(dq).add(startInfo.pivot);
        const quaternion = dq.clone().multiply(baseFit.quaternion);
        host.applyCamera(baseCam, aspect, { ...baseFit, position, quaternion }, useZoomPan ? baseCam.zoom : 1);
        const shiftX = useZoomPan ? (-baseCam.panX * RW) / 2 : 0;
        const shiftY = useZoomPan ? (baseCam.panY * RH) / 2 : 0;
        renderTiles(renderer, scene, host.activeCamera(), ctx, RW, RH, tile, shiftX, shiftY);
        if (low) {
          outCtx.imageSmoothingEnabled = true;
          outCtx.imageSmoothingQuality = 'high';
          outCtx.drawImage(low, 0, 0, RW, RH, 0, 0, W, H);
        }
      } finally {
        host.activeCamera().clearViewOffset();
        host.activeCamera().updateProjectionMatrix();
      }
    },
    end,
  };
}
