/**
 * The 3D stage: the renderer and its canvas, the scene with the model, the lights, ground shadow and floor
 * reflection, camera framing for the preview and for still exports, and the StageAPI (src/core/types/scene.ts) the
 * app drives.
 *
 * Design notes
 *  - Rendering is ON DEMAND: invalidate() schedules a single requestAnimationFrame; nothing runs
 *    while the scene is idle.
 *  - Color pipeline: physically based lights, sRGB output, NeutralToneMapping (keeps print
 *    artwork colors faithful – only highlights near white are gently compressed).
 *  - The canvas is always transparent (scene.background = null). The preview background is
 *    painted with CSS on the wrapper element; exports paint it in 2D when requested.
 *  - The lighting is camera-relative (see lighting.ts).
 *  - The camera orbits the model's bounding-box center; its distance / lateral offset is solved
 *    every frame so the whole composition (model + visible reflection + visible shadow) fits
 *    exactly (see ../framing.ts). zoom = lens zoom, pan = view offset – neither changes perspective.
 */
import * as THREE from 'three';
import type {
  AnimationFramingOptions,
  AnimationRenderSession,
  CameraSettings,
  RenderOptions,
  SceneSettings,
  StageAPI,
} from '../../core/types/scene';
import { DEFAULT_SCENE, cloneScene } from '../../core/defaults';
import { UserError } from '../../core/errors';
import { finite } from '../../core/math';
import { disposeObject } from '../dispose';
import { fitCamera, type FitResult } from '../framing';
import { GroundShadow, computeShadowLayout, type ShadowLayout } from '../shadows';
import { Reflection, REFLECTION_LAYER } from '../reflection';
import { applyCssBackground, paintBackground } from '../background';
import { cameraEquals, sanitizeCamera } from '../camera';
import { EMPTY_INFO, FitPoints, computeModelInfo, type ModelInfo } from './modelInfo';
import { gpuLimits, renderSize, renderTiles } from './tiles';
import { attachOrbit } from './orbit';
import { StudioLights } from './lighting';
import { startAnimation, type AnimationHandle, type TurntableHost } from './turntable';
import { log } from '../../platform/log';

// Framing.
/** Preview: composition fills ~85% of the view at zoom 1. */
const PREVIEW_SLACK = 1.18;
/** Export: tight framing with a little slack – the exporter crops to the content afterwards. */
const EXPORT_SLACK = 1.04;
/** Cameras closer than this count as an echo of the one the stage emitted. */
const ECHO_TOLERANCE = 1e-6;

// Shadow texture resolution caps.
const PREVIEW_SHADOW_RES = 1024;
const EXPORT_SHADOW_RES = 2048;

/** Create the 3D viewport inside `container` (fills it). */
export function createStage(container: HTMLElement): StageAPI {
  // DOM.
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

  // Scene.
  const scene = new THREE.Scene();
  scene.background = null;

  const lights = new StudioLights(renderer, scene);

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

  // State.
  let settings: SceneSettings = cloneScene(DEFAULT_SCENE);
  let model: THREE.Object3D | null = null;
  let info: ModelInfo = EMPTY_INFO;
  let rafId = 0;
  let disposed = false;
  let contextLost = false;
  const fitPoints = new FitPoints();
  /** The running animation (the viewport is frozen while it exists). */
  let anim: AnimationHandle | null = null;

  const listeners = new Set<(c: CameraSettings) => void>();
  let emitPending = false;
  /** The camera emitted last – a stale echo of it from applySettings() is ignored. */
  let lastEmitted: CameraSettings | null = null;
  let lastEmitTime = 0;

  applyCssBackground(wrapper, settings.background);

  // Rendering.
  function invalidate(): void {
    if (disposed || rafId) return;
    rafId = requestAnimationFrame(frame);
  }

  function viewSize(): { w: number; h: number } {
    return { w: Math.max(1, wrapper.clientWidth), h: Math.max(1, wrapper.clientHeight) };
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
    const pts = fitPoints.build(
      info.samples,
      reflOn ? reflection.visibleDepth(s.reflection) : null,
      Math.max(0, s.reflection.gap),
      shadowFit,
    );
    const fit = fitCamera(pts, info.pivot, cam, aspect, slack);
    const c = applyCamera(cam, aspect, fit, interactive ? cam.zoom : 1);
    if (interactive && (cam.panX !== 0 || cam.panY !== 0)) {
      // Pan = shift of the (zoomed) view by a fraction of its half size; content follows +panX right, +panY up.
      const fw = 1000 * aspect;
      const fh = 1000;
      c.setViewOffset(fw, fh, (-cam.panX * fw) / 2, (cam.panY * fh) / 2, fw, fh);
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

  /**
   * Lights, environment rotation, ground shadow and reflection for a camera yaw.
   * Returns the shadow layout (null = no shadow).
   */
  function layoutEffects(s: SceneSettings, yaw: number, aboveFloor: boolean, shadowRes: number): ShadowLayout | null {
    const { lightDir, keyIntensity } = lights.update(s, yaw, info.pivot, info.size);

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
      lastEmitted = c;
      lastEmitTime = performance.now();
      for (const cb of [...listeners]) {
        try {
          cb({ ...c });
        } catch (err) {
          log.error('A camera listener failed', err);
        }
      }
    }
  }

  /** Render the on-screen view right now (inside the current task). */
  function frameNow(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
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

  // Interaction.
  const abort = new AbortController();
  const { signal } = abort;

  function cameraChanged(): void {
    emitPending = true;
    invalidate();
  }

  const orbit = attachOrbit(canvas, { signal, camera: () => settings.camera, viewSize, changed: cameraChanged });

  canvas.addEventListener(
    'webglcontextlost',
    (e: Event) => {
      e.preventDefault();
      contextLost = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      contextLost = false;
      lights.restoreContext();
      shadow.invalidate();
      invalidate();
    },
    { signal },
  );

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  // devicePixelRatio changes (moving between displays).
  window.addEventListener('resize', () => resize(), { signal });
  resize();

  const turntable: TurntableHost = {
    renderer,
    scene,
    wrapper,
    reflection,
    fitPoints,
    isDisposed: () => disposed,
    isContextLost: () => contextLost,
    settings: () => settings,
    model: () => model,
    info: () => info,
    frameNow,
    resize,
    cancelGestures: () => orbit.cancel(),
    layoutExportEffects(s, yaw, aboveFloor) {
      layoutEffects(s, yaw, aboveFloor, EXPORT_SHADOW_RES);
    },
    applyCamera,
    activeCamera: () => activeCam,
    animation: () => anim,
    setAnimation(handle) {
      anim = handle;
    },
  };

  // API.
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
      // change (undo/redo, a view from the view bar) and must be applied.
      const recentlyActive = orbit.isActive() || performance.now() - lastEmitTime < 500;
      if (recentlyActive && lastEmitted && cameraEquals(lastEmitted, camera, ECHO_TOLERANCE)) camera = settings.camera;
      next.camera = { ...camera };
      settings = next;
      applyCssBackground(wrapper, settings.background);
      invalidate();
    },

    onCameraChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    renderToCanvas(o: RenderOptions): HTMLCanvasElement {
      const W = Math.max(1, Math.round(finite(o.width, 1)));
      const H = Math.max(1, Math.round(finite(o.height, 1)));
      if (disposed || contextLost)
        throw new UserError('The 3D preview is not available right now. Try again in a moment.');
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const outCtx = out.getContext('2d');
      if (!outCtx) {
        throw new UserError(
          'The image could not be rendered: there may not be enough graphics memory. Reduce the export size.',
        );
      }
      if (!o.transparent) paintBackground(outCtx, W, H, settings.background);

      const { limit, tile } = gpuLimits(renderer);
      // If the GPU cannot render this big, render smaller and scale up into the exact size.
      const { scale, width: RW, height: RH } = renderSize(W, H, limit);
      let target = out;
      let ctx = outCtx;
      if (scale < 1) {
        target = document.createElement('canvas');
        target.width = RW;
        target.height = RH;
        const targetCtx = target.getContext('2d');
        if (!targetCtx) throw new UserError('Not enough memory for an image this large. Reduce the export size.');
        ctx = targetCtx;
      }
      const prevRatio = renderer.getPixelRatio();
      const prevSize = renderer.getSize(new THREE.Vector2());
      try {
        renderer.setPixelRatio(1);
        layoutScene(RW / RH, EXPORT_SLACK, false, EXPORT_SHADOW_RES);
        renderTiles(renderer, scene, activeCam, ctx, RW, RH, tile, 0, 0);
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
      return startAnimation(turntable, o);
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
      lights.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      wrapper.remove();
    },
  };
}
