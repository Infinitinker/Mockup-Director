/**
 * Mockup Director 3D stage: renderer, studio lighting, ground shadow, floor reflection, camera framing,
 * viewport interaction and exact-size off-screen rendering for export.
 *
 * Design notes
 *  - Rendering is ON DEMAND: invalidate() schedules a single requestAnimationFrame; nothing runs
 *    while the scene is idle.
 *  - Colour pipeline: physically based lights, sRGB output, NeutralToneMapping (keeps print
 *    artwork colours faithful – only highlights near white are gently compressed).
 *  - The canvas is always transparent (scene.background = null). The preview background is
 *    painted with CSS on the wrapper element; exports paint it in 2D when requested.
 *  - LIGHTING IS CAMERA-RELATIVE ("turntable studio"): LightSettings.azimuth is measured from the
 *    camera's yaw, so "key light from the upper left" stays upper-left while the user orbits –
 *    exactly like rotating a product in front of a fixed studio setup. The environment map and
 *    the key-light shadow rotate with it. Elevation is measured from the floor (horizon).
 *  - The camera orbits the model's bounding-box centre; its distance / lateral offset is solved
 *    every frame so the whole composition (model + visible reflection + visible shadow) fits
 *    exactly (see framing.ts). zoom = lens zoom, pan = view offset – neither changes perspective.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  AnimationFramingOptions,
  AnimationRenderSession,
  CameraSettings,
  LocalizedText,
  RenderOptions,
  SceneSettings,
  StageAPI,
} from '../core/types';
import { DEFAULT_SCENE, cloneScene } from '../core/defaults';
import { disposeObject } from '../models/shared';
import { UnionFit, fitCamera, type FitResult } from './framing';
import { GroundShadow, computeShadowLayout, type ShadowLayout } from './shadows';
import { Reflection, REFLECTION_LAYER } from './reflection';
import { applyCssBackground, paintBackground } from './background';

const DEG = Math.PI / 180;

/* --- Light calibration (physically based units, see three.js r155+ lighting) ---------------- */
/** DirectionalLight intensity = LightSettings.intensity * KEY_SCALE. Lambert: radiance = albedo * I * cos / π. */
const KEY_SCALE = 3.2;
/** HemisphereLight intensity = LightSettings.ambient * FILL_SCALE. */
const FILL_SCALE = 1.2;
/** scene.environmentIntensity = LightSettings.environment * ENV_SCALE (RoomEnvironment is bright). */
const ENV_SCALE = 0.3;

/* --- Framing / interaction ------------------------------------------------------------------- */
/** Preview: composition fills ~85% of the view at zoom 1. */
const PREVIEW_SLACK = 1.18;
/** Export: tight framing with a little slack – the exporter crops to the content afterwards. */
const EXPORT_SLACK = 1.04;
/**
 * Animation: same slack as stills. Animations are NOT cropped to the alpha bounds afterwards (that
 * would make the composition breathe), so the slack also keeps the soft shadow's faint tails in.
 */
const ANIM_SLACK = 1.04;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const PITCH_LIMIT = 89;
const ORBIT_DEG_PER_PX = 0.35;
/** Max model vertices used for exact framing (subsampled above that). */
const MAX_FIT_POINTS = 24000;

/* --- Shadow texture resolution caps ------------------------------------------------------------ */
const PREVIEW_SHADOW_RES = 1024;
const EXPORT_SHADOW_RES = 2048;
/** Largest off-screen render we attempt (4000 px exports + supersampling). */
const MAX_RENDER_SIZE = 8192;
/** Exports are rendered in tiles of at most this size (keeps the drawing buffer small). */
const MAX_TILE = 2048;

interface ModelInfo {
  bounds: THREE.Box3;
  pivot: THREE.Vector3;
  height: number;
  size: number;
  /** Subsampled world-space vertex positions (xyz) used for exact framing. */
  samples: Float32Array;
}

function boxCorners(b: THREE.Box3): Float32Array {
  const out = new Float32Array(24);
  let i = 0;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    out[i++] = x; out[i++] = y; out[i++] = z;
  }
  return out;
}

const EMPTY_INFO: ModelInfo = (() => {
  const bounds = new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 100, 50));
  return { bounds, pivot: new THREE.Vector3(0, 50, 0), height: 100, size: 100, samples: boxCorners(bounds) };
})();

/** Bounds + a vertex sample of the model in world space. */
function computeModelInfo(model: THREE.Object3D): ModelInfo {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return EMPTY_INFO;

  const meshes: THREE.Mesh[] = [];
  let total = 0;
  model.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute('position')) {
      meshes.push(m);
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      total += m.geometry.getAttribute('position').count * inst;
    }
  });
  const stride = Math.max(1, Math.ceil(total / MAX_FIT_POINTS));
  const pts: number[] = [];
  const v = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const instM = new THREE.Matrix4();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const inst = m as THREE.InstancedMesh;
    const count = inst.isInstancedMesh ? inst.count : 1;
    for (let k = 0; k < count; k++) {
      if (inst.isInstancedMesh) {
        inst.getMatrixAt(k, instM);
        mat.multiplyMatrices(m.matrixWorld, instM);
      } else {
        mat.copy(m.matrixWorld);
      }
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mat);
        pts.push(v.x, v.y, v.z);
      }
    }
  }
  const samples = pts.length ? new Float32Array(pts) : boxCorners(bounds);
  const height = Math.max(bounds.max.y, bounds.max.y - bounds.min.y, 1e-3);
  const sz = bounds.getSize(new THREE.Vector3());
  return {
    bounds,
    pivot: bounds.getCenter(new THREE.Vector3()),
    height,
    size: Math.max(sz.x, sz.y, sz.z, 1),
    samples,
  };
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Wrap an angle to (-180, 180]. */
function wrapDeg(a: number): number {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

function sanitizeCamera(c: Partial<CameraSettings> | undefined): CameraSettings {
  const d = DEFAULT_SCENE.camera;
  const src = c ?? {};
  return {
    yaw: finite(src.yaw, d.yaw),
    pitch: THREE.MathUtils.clamp(finite(src.pitch, d.pitch), -PITCH_LIMIT, PITCH_LIMIT),
    roll: finite(src.roll, d.roll),
    fov: THREE.MathUtils.clamp(finite(src.fov, d.fov), 1, 120),
    projection: src.projection === 'orthographic' ? 'orthographic' : 'perspective',
    zoom: THREE.MathUtils.clamp(finite(src.zoom, d.zoom), ZOOM_MIN, ZOOM_MAX),
    panX: THREE.MathUtils.clamp(finite(src.panX, 0), -1, 1),
    panY: THREE.MathUtils.clamp(finite(src.panY, 0), -1, 1),
  };
}

function cameraEquals(a: CameraSettings, b: CameraSettings): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return eq(a.yaw, b.yaw) && eq(a.pitch, b.pitch) && eq(a.roll, b.roll) && eq(a.fov, b.fov) &&
    a.projection === b.projection && eq(a.zoom, b.zoom) && eq(a.panX, b.panX) && eq(a.panY, b.panY);
}

/** Stage failure with a localized message (errorMessage() in the UI shows `text`). */
class StageError extends Error {
  readonly text: LocalizedText;
  constructor(text: LocalizedText) {
    super(`${text.pl} / ${text.en}`);
    this.name = 'StageError';
    this.text = text;
  }
}

/** Safari's non-standard trackpad pinch event. */
interface GestureLikeEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** Create the 3D viewport inside `container` (fills it). */
export function createStage(container: HTMLElement): StageAPI {
  /* ---------------- DOM ---------------- */
  const wrapper = document.createElement('div');
  wrapper.className = 'mockup-director-stage';
  Object.assign(wrapper.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);
  container.appendChild(wrapper);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false; // shadows are rendered by GroundShadow
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    touchAction: 'none',
    cursor: 'grab',
    outline: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  (canvas.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
  canvas.style.userSelect = 'none';
  wrapper.appendChild(canvas);

  /* ---------------- Scene ---------------- */
  const scene = new THREE.Scene();
  scene.background = null;

  let pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;
  const buildEnvironment = () => {
    envRT?.dispose();
    const room = new RoomEnvironment();
    envRT = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = envRT.texture;
  };
  buildEnvironment();

  const keyLight = new THREE.DirectionalLight(0xffffff, 1);
  keyLight.castShadow = false;
  scene.add(keyLight, keyLight.target);
  // Soft fill: neutral sky, slightly warm floor bounce.
  const fillLight = new THREE.HemisphereLight(0xffffff, 0xb9b4ac, 1);
  scene.add(fillLight);

  const holder = new THREE.Group(); // identity transform – the model is its only child
  holder.name = 'mockup-director-model-holder';
  scene.add(holder);

  const reflection = new Reflection();
  scene.add(reflection.group);
  const shadow = new GroundShadow(renderer);
  scene.add(shadow.mesh);

  const perspCam = new THREE.PerspectiveCamera(24, 1, 1, 10000);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
  for (const c of [perspCam, orthoCam]) c.layers.enable(REFLECTION_LAYER);
  let activeCam: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspCam;

  /* ---------------- State ---------------- */
  let settings: SceneSettings = cloneScene(DEFAULT_SCENE);
  let model: THREE.Object3D | null = null;
  let info: ModelInfo = EMPTY_INFO;
  let rafId = 0;
  let disposed = false;
  let contextLost = false;
  const lightDir = new THREE.Vector3(0, 1, 0);
  let fitBuffer = new Float32Array(0);
  /** The running animation session (the viewport is frozen while it exists). */
  let anim: { end(): void } | null = null;

  const listeners = new Set<(c: CameraSettings) => void>();
  let emitPending = false;
  /** Recently emitted cameras – stale echoes of these from applySettings() are ignored. */
  const recentEmitted: CameraSettings[] = [];
  let lastEmitTime = 0;

  applyCssBackground(wrapper, settings.background);

  /* ---------------- Rendering ---------------- */
  function invalidate(): void {
    if (disposed || rafId) return;
    rafId = requestAnimationFrame(frame);
  }

  function viewSize(): { w: number; h: number } {
    return { w: Math.max(1, wrapper.clientWidth), h: Math.max(1, wrapper.clientHeight) };
  }

  /** Collect the points that must be visible: model, visible reflection, visible shadow. */
  function buildFitPoints(reflDepth: number | null, gap: number, shadowRect: ShadowLayout['visible'] | null): Float32Array {
    const s = info.samples;
    const n = s.length / 3;
    const need = s.length * 2 + 12;
    if (fitBuffer.length < need) fitBuffer = new Float32Array(need);
    const out = fitBuffer;
    out.set(s, 0);
    let k = s.length;
    if (reflDepth !== null && reflDepth > 0) {
      // Mirror of every sample, clamped to the depth where the reflection has faded out
      // (clamping keeps e.g. a box's vertical edges, whose only vertices are the corners).
      for (let i = 0; i < n; i++) {
        out[k++] = s[i * 3];
        out[k++] = -gap - Math.min(Math.max(s[i * 3 + 1], 0), reflDepth);
        out[k++] = s[i * 3 + 2];
      }
    }
    if (shadowRect) {
      for (const [x, z] of [
        [shadowRect.minX, shadowRect.minZ], [shadowRect.maxX, shadowRect.minZ],
        [shadowRect.minX, shadowRect.maxZ], [shadowRect.maxX, shadowRect.maxZ],
      ]) {
        out[k++] = x; out[k++] = 0; out[k++] = z;
      }
    }
    return out.subarray(0, k);
  }

  /**
   * Update lights, shadow, reflection and camera for a view of the given aspect ratio.
   * `interactive` = apply zoom / pan (preview); exports ignore them.
   */
  function layoutScene(aspect: number, slack: number, interactive: boolean, shadowRes: number): void {
    const s = settings;
    const cam = s.camera;
    // Floor effects only make sense when the camera is above the floor.
    const aboveFloor = cam.pitch >= 0;

    const shadowLayout = layoutEffects(s, cam.yaw, aboveFloor, shadowRes);
    const reflOn = reflection.group.visible;

    // Camera fit.
    // Preview framing ignores the key-light shadow (it moves with the light); exports include it.
    const shadowFit = shadowLayout ? (interactive ? shadowLayout.contactVisible : shadowLayout.visible) : null;
    const pts = buildFitPoints(reflOn ? reflection.visibleDepth(s.reflection) : null, Math.max(0, s.reflection.gap), shadowFit);
    const fit = fitCamera(pts, info.pivot, cam, aspect, slack);
    const c = applyCamera(cam, aspect, fit, interactive ? cam.zoom : 1);
    if (interactive && (cam.panX !== 0 || cam.panY !== 0)) {
      // Pan = shift of the (zoomed) view by a fraction of its half size; content follows +panX right, +panY up.
      const fw = 1000 * aspect;
      const fh = 1000;
      c.setViewOffset(fw, fh, -cam.panX * fw / 2, cam.panY * fh / 2, fw, fh);
    } else {
      c.clearViewOffset();
    }
    c.updateProjectionMatrix();
  }

  /** Configure (and activate) the camera for a solved framing. The caller updates the projection. */
  function applyCamera(
    cam: CameraSettings,
    aspect: number,
    fit: FitResult,
    zoom: number,
  ): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    let c: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    if (cam.projection === 'orthographic') {
      const hh = fit.orthoHalfHeight;
      orthoCam.left = -hh * aspect;
      orthoCam.right = hh * aspect;
      orthoCam.top = hh;
      orthoCam.bottom = -hh;
      c = orthoCam;
    } else {
      perspCam.fov = cam.fov;
      perspCam.aspect = aspect;
      c = perspCam;
    }
    c.near = fit.near;
    c.far = fit.far;
    c.zoom = zoom;
    c.position.copy(fit.position);
    c.quaternion.copy(fit.quaternion);
    c.updateMatrixWorld(true);
    activeCam = c;
    return c;
  }

  /** Unit vector TOWARDS the key light for a camera yaw (the light rig is camera-relative). */
  function keyLightDir(s: SceneSettings, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    // Key light: azimuth relative to the camera yaw, elevation from the horizon.
    const az = (yaw + finite(s.light.azimuth, 0)) * DEG;
    const el = THREE.MathUtils.clamp(finite(s.light.elevation, 45), -89, 89.5) * DEG;
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  }

  /**
   * Lights, environment rotation, ground shadow and reflection for a camera yaw.
   * Returns the shadow layout (null = no shadow).
   */
  function layoutEffects(s: SceneSettings, yaw: number, aboveFloor: boolean, shadowRes: number): ShadowLayout | null {
    keyLightDir(s, yaw, lightDir);
    keyLight.position.copy(info.pivot).addScaledVector(lightDir, info.size * 4 + 100);
    keyLight.target.position.copy(info.pivot);
    keyLight.target.updateMatrixWorld();
    try { keyLight.color.set(s.light.color); } catch { keyLight.color.set(0xffffff); }
    const keyIntensity = THREE.MathUtils.clamp(finite(s.light.intensity, 1), 0, 3);
    keyLight.intensity = keyIntensity * KEY_SCALE;
    fillLight.intensity = THREE.MathUtils.clamp(finite(s.light.ambient, 0.5), 0, 2) * FILL_SCALE;
    scene.environmentIntensity = THREE.MathUtils.clamp(finite(s.light.environment, 1), 0, 2) * ENV_SCALE;
    scene.environmentRotation.set(0, yaw * DEG, 0);

    // Ground shadow.
    let shadowLayout: ShadowLayout | null = null;
    const shadowOn = !!model && s.shadow.enabled && s.shadow.opacity > 0 && aboveFloor;
    if (shadowOn) {
      shadowLayout = computeShadowLayout({ bounds: info.bounds, lightDir, softness: s.shadow.softness, keyIntensity });
      shadow.update(model, shadowLayout, shadowRes);
      shadow.setOpacity(s.shadow.opacity);
    }
    shadow.mesh.visible = shadowOn;

    // Reflection.
    reflection.update(s.reflection, aboveFloor);
    return shadowLayout;
  }

  function frame(): void {
    rafId = 0;
    if (disposed || contextLost) return;
    // While an animation is rendered the viewport shows a frozen snapshot; repaint at the end.
    if (anim) return;
    const { w, h } = viewSize();
    layoutScene(w / h, PREVIEW_SLACK, true, PREVIEW_SHADOW_RES);
    renderer.render(scene, activeCam);
    if (emitPending) {
      emitPending = false;
      const c = { ...settings.camera };
      recentEmitted.push(c);
      if (recentEmitted.length > 12) recentEmitted.shift();
      lastEmitTime = performance.now();
      for (const cb of [...listeners]) {
        try { cb({ ...c }); } catch (err) { console.error(err); }
      }
    }
  }

  /** Largest off-screen render side and the tile size the GPU allows. */
  function gpuLimits(): { limit: number; tile: number } {
    const gl = renderer.getContext();
    const maxRB = finite(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096);
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
    const maxVP = vp ? Math.min(vp[0], vp[1]) : 4096;
    return {
      limit: Math.min(MAX_RENDER_SIZE, renderer.capabilities.maxTextureSize, maxRB),
      tile: Math.max(256, Math.min(MAX_TILE, maxRB, maxVP)),
    };
  }

  /**
   * Render the active camera's view (already laid out for an RW × RH frame) tile by tile into ctx.
   * Each tile is an off-axis slice of the same projection, drawn into the 2D canvas right after
   * rendering (same task) – drawImage un-premultiplies correctly. shiftX / shiftY move the whole
   * window (in px of the RW × RH frame) – used for the viewport pan in animations.
   * The caller must set the pixel ratio to 1 and restore the renderer size afterwards.
   */
  function renderTiles(ctx: CanvasRenderingContext2D, RW: number, RH: number, tile: number, shiftX: number, shiftY: number): void {
    const cam = activeCam;
    for (let y = 0; y < RH; y += tile) {
      for (let x = 0; x < RW; x += tile) {
        const tw = Math.min(tile, RW - x);
        const th = Math.min(tile, RH - y);
        renderer.setSize(tw, th, false);
        cam.setViewOffset(RW, RH, x + shiftX, y + shiftY, tw, th);
        cam.updateProjectionMatrix();
        renderer.render(scene, cam);
        ctx.drawImage(canvas, 0, 0, tw, th, x, y, tw, th);
      }
    }
  }

  /** Render the on-screen view right now (inside the current task). */
  function frameNow(): void {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    frame();
  }

  function resize(): void {
    if (disposed) return;
    const { w, h } = viewSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    const cur = renderer.getSize(new THREE.Vector2());
    if (cur.x !== w || cur.y !== h) renderer.setSize(w, h, false);
    invalidate();
  }

  /* ---------------- Interaction ---------------- */
  const abort = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window,
    type: K | string,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts: AddEventListenerOptions = {},
  ) => el.addEventListener(type, fn as EventListener, { ...opts, signal: abort.signal });

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; mx: number; my: number } | null = null;
  let gestureActive = false;
  let gestureLastScale = 1;

  function cameraChanged(): void {
    emitPending = true;
    invalidate();
  }

  /** Zoom by `factor` keeping the point under the cursor fixed (as far as the pan range allows). */
  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const cam = settings.camera;
    const z2 = THREE.MathUtils.clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    if (z2 === cam.zoom) return;
    const rect = canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const sy = -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    // Screen position = zoom * p + pan  ->  keep the cursor's p fixed.
    const r = z2 / cam.zoom;
    cam.panX = THREE.MathUtils.clamp(sx - r * (sx - cam.panX), -1, 1);
    cam.panY = THREE.MathUtils.clamp(sy - r * (sy - cam.panY), -1, 1);
    cam.zoom = z2;
    cameraChanged();
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  on(canvas, 'pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = pinchState();
    canvas.style.cursor = 'grabbing';
  });

  on(canvas, 'pointermove', (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    const cam = settings.camera;
    const { w, h } = viewSize();

    if (pointers.size >= 2) {
      // Two fingers: pinch = zoom, move = pan.
      if (!pinch) { pinch = pinchState(); return; }
      const now = pinchState();
      if (pinch.dist > 0 && now.dist > 0) {
        cam.zoom = THREE.MathUtils.clamp(cam.zoom * (now.dist / pinch.dist), ZOOM_MIN, ZOOM_MAX);
      }
      cam.panX = THREE.MathUtils.clamp(cam.panX + (now.mx - pinch.mx) / (w / 2), -1, 1);
      cam.panY = THREE.MathUtils.clamp(cam.panY - (now.my - pinch.my) / (h / 2), -1, 1);
      pinch = now;
      cameraChanged();
      return;
    }

    const panMode = e.pointerType === 'mouse' && ((e.buttons & 6) !== 0 || e.shiftKey);
    if (panMode) {
      cam.panX = THREE.MathUtils.clamp(cam.panX + dx / (w / 2), -1, 1);
      cam.panY = THREE.MathUtils.clamp(cam.panY - dy / (h / 2), -1, 1);
    } else {
      // Turntable: drag right turns the product to the right (camera moves left).
      cam.yaw = wrapDeg(cam.yaw - dx * ORBIT_DEG_PER_PX);
      cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * ORBIT_DEG_PER_PX, -PITCH_LIMIT, PITCH_LIMIT);
    }
    cameraChanged();
  });

  const endPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    pinch = pointers.size >= 2 ? pinchState() : null;
    if (pointers.size === 0) canvas.style.cursor = 'grab';
  };
  on(canvas, 'pointerup', endPointer);
  on(canvas, 'pointercancel', endPointer);
  on(canvas, 'lostpointercapture', endPointer);
  on(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault());

  on(canvas, 'wheel', (e: WheelEvent) => {
    e.preventDefault(); // also blocks browser pinch-zoom (ctrl+wheel)
    if (gestureActive) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= viewSize().h;
    // ctrlKey = trackpad pinch in Chromium/Firefox – deltas are small, so use a stronger factor.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    zoomAt(e.clientX, e.clientY, Math.exp(-THREE.MathUtils.clamp(dy, -200, 200) * k));
  }, { passive: false });

  // Safari / WKWebView trackpad pinch (non-standard GestureEvent). Harmless elsewhere.
  on(canvas, 'gesturestart', (e: Event) => {
    e.preventDefault();
    gestureActive = true;
    gestureLastScale = 1;
  });
  on(canvas, 'gesturechange', (e: Event) => {
    e.preventDefault();
    const g = e as GestureLikeEvent;
    if (!(g.scale > 0)) return;
    zoomAt(g.clientX, g.clientY, g.scale / gestureLastScale);
    gestureLastScale = g.scale;
  });
  on(canvas, 'gestureend', (e: Event) => {
    e.preventDefault();
    gestureActive = false;
  });

  on(canvas, 'dblclick', (e: MouseEvent) => {
    e.preventDefault();
    const cam = settings.camera;
    if (cam.zoom === 1 && cam.panX === 0 && cam.panY === 0) return;
    cam.zoom = 1;
    cam.panX = 0;
    cam.panY = 0;
    cameraChanged();
  });

  on(canvas, 'webglcontextlost', (e: Event) => {
    e.preventDefault();
    contextLost = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  });
  on(canvas, 'webglcontextrestored', () => {
    contextLost = false;
    pmrem.dispose();
    pmrem = new THREE.PMREMGenerator(renderer);
    buildEnvironment();
    shadow.invalidate();
    invalidate();
  });

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  on(window, 'resize', () => resize()); // devicePixelRatio changes (moving between displays)
  resize();

  /* ---------------- Turntable animation ---------------- */

  /**
   * Turntable = the CAMERA orbits the vertical axis through the model's centre. Because the light
   * rig, the environment rotation and the key-light shadow are all camera-relative, this is exactly
   * what a product turning on a turntable in front of a fixed studio looks like: highlights stay
   * put, the shadow swings around the product consistently and the floor reflection (a mirror
   * about y = 0) is correct in every frame. The model itself is never touched.
   *
   * Framing: every frame is the base view rotated by Ry(-angle) around the pivot, so measuring the
   * point clouds rotated by +angle in the BASE camera's frame gives one fit (UnionFit) that is
   * valid for all frames – the composition is fixed and never cropped.
   */
  function startAnimation(o: AnimationFramingOptions): AnimationRenderSession {
    if (disposed || contextLost) throw new StageError({ pl: 'Podgląd 3D jest niedostępny.', en: 'The 3D view is not available.' });
    anim?.end();

    const angles = (Array.isArray(o.angles) ? o.angles : []).map((a) => finite(a, 0));
    if (!angles.length) angles.push(0);
    const W = Math.max(1, Math.round(finite(o.width, 1)));
    const H = Math.max(1, Math.round(finite(o.height, 1)));
    const { limit, tile } = gpuLimits();
    const scale = Math.min(1, limit / Math.max(W, H));
    const RW = Math.max(1, Math.floor(W * scale));
    const RH = Math.max(1, Math.floor(H * scale));
    const aspect = RW / RH;

    // Snapshot: later UI changes must not leak into a running animation.
    const snap = cloneScene(settings);
    const baseCam = snap.camera;
    const startModel = model;
    const startInfo = info;
    const aboveFloor = baseCam.pitch >= 0;
    const useZoomPan = !!o.useViewZoomPan;

    /* --- one framing for the union of all frames --- */
    reflection.update(snap.reflection, aboveFloor);
    const reflDepth = reflection.group.visible ? reflection.visibleDepth(snap.reflection) : null;
    // Model + reflection samples are fixed in world space (copy: buildFitPoints reuses its buffer).
    const basePts = buildFitPoints(reflDepth, Math.max(0, snap.reflection.gap), null).slice();
    const shadowOn = !!startModel && snap.shadow.enabled && snap.shadow.opacity > 0 && aboveFloor;
    const keyIntensity = THREE.MathUtils.clamp(finite(snap.light.intensity, 1), 0, 3);
    const union = new UnionFit(startInfo.pivot, baseCam, aspect, ANIM_SLACK);
    const dir = new THREE.Vector3();
    const corners = new Float32Array(12);
    const seen = new Set<number>();
    for (const a of angles) {
      const key = Math.round(a * 1e6);
      if (seen.has(key)) continue; // swings repeat every angle twice
      seen.add(key);
      union.add(basePts, a);
      if (shadowOn) {
        // The key-light shadow follows the camera-relative light: its rectangle differs per frame.
        keyLightDir(snap, baseCam.yaw - a, dir);
        const r = computeShadowLayout({ bounds: startInfo.bounds, lightDir: dir, softness: snap.shadow.softness, keyIntensity }).visible;
        corners.set([r.minX, 0, r.minZ, r.maxX, 0, r.minZ, r.minX, 0, r.maxZ, r.maxX, 0, r.maxZ]);
        union.add(corners, a);
      }
    }
    const baseFit = union.result();

    /* --- freeze the viewport --- */
    frameNow(); // fresh pixels in the drawing buffer – copied below in the same task
    const overlay = document.createElement('canvas');
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    try {
      overlay.getContext('2d')?.drawImage(canvas, 0, 0);
    } catch {
      /* an empty overlay is fine */
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
    pointers.clear();
    pinch = null;
    canvas.style.cursor = 'grab';

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
      if (anim === handle) anim = null;
      overlay.remove();
      overlay.width = 0;
      overlay.height = 0;
      if (low) { low.width = 0; low.height = 0; low = null; }
      if (disposed) return;
      activeCam.clearViewOffset();
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      resize(); // the viewport may have been resized meanwhile
      frameNow();
    };
    const handle = { end };
    anim = handle;

    return {
      frameCount: angles.length,
      renderFrame(index: number, target: HTMLCanvasElement) {
        if (ended) throw new Error('The animation session has ended.');
        if (disposed || contextLost || model !== startModel) {
          throw new StageError({
            pl: 'Scena zmieniła się podczas renderowania animacji. Spróbuj ponownie.',
            en: 'The scene changed while the animation was being rendered. Please try again.',
          });
        }
        const i = THREE.MathUtils.clamp(Math.round(finite(index, 0)), 0, angles.length - 1);
        const a = angles[i];
        if (target.width !== W) target.width = W;
        if (target.height !== H) target.height = H;
        const outCtx = target.getContext('2d');
        if (!outCtx) {
          throw new StageError({ pl: 'Za mało pamięci na klatkę animacji.', en: 'Not enough memory for an animation frame.' });
        }
        outCtx.clearRect(0, 0, W, H);
        let ctx = outCtx;
        if (scale < 1) {
          if (!low) {
            low = document.createElement('canvas');
            low.width = RW;
            low.height = RH;
          }
          ctx = low.getContext('2d')!;
          ctx.clearRect(0, 0, RW, RH);
        }
        try {
          renderer.setPixelRatio(1);
          layoutEffects(snap, baseCam.yaw - a, aboveFloor, EXPORT_SHADOW_RES);
          // Camera yaw offset = -angle: rotate the base framing around the vertical pivot axis.
          dq.setFromAxisAngle(yAxis, -a * DEG);
          const position = baseFit.position.clone().sub(startInfo.pivot).applyQuaternion(dq).add(startInfo.pivot);
          const quaternion = dq.clone().multiply(baseFit.quaternion);
          applyCamera(baseCam, aspect, { ...baseFit, position, quaternion }, useZoomPan ? baseCam.zoom : 1);
          const shiftX = useZoomPan ? (-baseCam.panX * RW) / 2 : 0;
          const shiftY = useZoomPan ? (baseCam.panY * RH) / 2 : 0;
          renderTiles(ctx, RW, RH, tile, shiftX, shiftY);
          if (low) {
            outCtx.imageSmoothingEnabled = true;
            outCtx.imageSmoothingQuality = 'high';
            outCtx.drawImage(low, 0, 0, RW, RH, 0, 0, W, H);
          }
        } finally {
          activeCam.clearViewOffset();
          activeCam.updateProjectionMatrix();
        }
      },
      end,
    };
  }

  /* ---------------- API ---------------- */
  return {
    setModel(object: THREE.Object3D | null) {
      if (disposed) return;
      reflection.setModel(null, 1);
      if (model) {
        holder.remove(model);
        if (model !== object) disposeObject(model);
      }
      model = object;
      if (object) {
        if (object.parent) object.parent.remove(object);
        holder.add(object);
        info = computeModelInfo(object);
      } else {
        info = EMPTY_INFO;
      }
      reflection.setModel(object, info.height);
      shadow.invalidate();
      invalidate();
    },

    applySettings(s: SceneSettings) {
      if (disposed) return;
      const next = cloneScene(s);
      let camera = sanitizeCamera(next.camera);
      // Ignore a stale echo of the camera we emitted LAST (UI sliders following a drag). Only the
      // most recent emission is matched: an older emitted camera arriving here is a deliberate
      // change (undo/redo, preset view) and must be applied.
      const recentlyActive = pointers.size > 0 || gestureActive || performance.now() - lastEmitTime < 500;
      const lastEmitted = recentEmitted[recentEmitted.length - 1];
      if (recentlyActive && lastEmitted && cameraEquals(lastEmitted, camera)) camera = settings.camera;
      next.camera = { ...camera };
      settings = next;
      applyCssBackground(wrapper, settings.background);
      invalidate();
    },

    onCameraChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    renderToCanvas(o: RenderOptions): HTMLCanvasElement {
      const W = Math.max(1, Math.round(finite(o.width, 1)));
      const H = Math.max(1, Math.round(finite(o.height, 1)));
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const outCtx = out.getContext('2d');
      if (!outCtx) return out;
      if (!o.transparent) paintBackground(outCtx, W, H, settings.background);
      if (disposed || contextLost) return out;

      const { limit, tile } = gpuLimits();
      // If the GPU cannot render this big, render smaller and scale up into the exact size.
      const scale = Math.min(1, limit / Math.max(W, H));
      const RW = Math.max(1, Math.floor(W * scale));
      const RH = Math.max(1, Math.floor(H * scale));
      let target = out;
      let ctx = outCtx;
      if (scale < 1) {
        target = document.createElement('canvas');
        target.width = RW;
        target.height = RH;
        ctx = target.getContext('2d')!;
      }
      const prevRatio = renderer.getPixelRatio();
      const prevSize = renderer.getSize(new THREE.Vector2());
      try {
        renderer.setPixelRatio(1);
        layoutScene(RW / RH, EXPORT_SLACK, false, EXPORT_SHADOW_RES);
        renderTiles(ctx, RW, RH, tile, 0, 0);
        if (target !== out) {
          outCtx.imageSmoothingEnabled = true;
          outCtx.imageSmoothingQuality = 'high';
          outCtx.drawImage(target, 0, 0, RW, RH, 0, 0, W, H);
        }
      } finally {
        activeCam.clearViewOffset();
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.x, prevSize.y, false);
        // Repaint the viewport in the same task so the on-screen canvas never shows a tile.
        frameNow();
      }
      return out;
    },

    resize,

    beginAnimation(o: AnimationFramingOptions): AnimationRenderSession {
      return startAnimation(o);
    },

    dispose() {
      if (disposed) return;
      anim?.end();
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      ro.disconnect();
      abort.abort();
      listeners.clear();
      reflection.dispose();
      shadow.dispose();
      if (model) {
        holder.remove(model);
        disposeObject(model);
        model = null;
      }
      scene.environment = null;
      envRT?.dispose();
      envRT = null;
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      wrapper.remove();
    },
  };
}
