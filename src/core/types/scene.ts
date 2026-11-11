/**
 * The scene and the stage contract: the camera, light, shadow, reflection and preview background of a project,
 * and what the stage that shows them offers (`StageAPI`: showing a model, rendering stills, turntable sessions).
 * Angles follow the 3D conventions in `./model.ts` (yaw 0 = front, + = toward +X; pitch + = from above).
 */
import type * as THREE from 'three';

export interface CameraSettings {
  /** degrees, 0 = front, + = toward the model's right side */
  yaw: number;
  /** degrees, + = from above */
  pitch: number;
  /** degrees, rotation around the view axis */
  roll: number;
  /** vertical field of view in degrees (perspective only). Small = flat/tele, large = strong perspective */
  fov: number;
  projection: 'perspective' | 'orthographic';
  /** 1 = model fits the view automatically; >1 = closer */
  zoom: number;
  /** pan as a fraction of the view (-1..1) */
  panX: number;
  panY: number;
}

export interface LightSettings {
  /** Key light direction, degrees. Azimuth 0 = from the camera-front (+Z), + = from the right. */
  azimuth: number;
  /** degrees above the horizon */
  elevation: number;
  /** key light intensity multiplier (0..3) */
  intensity: number;
  /** ambient / fill intensity (0..2) */
  ambient: number;
  /** environment (reflections) intensity (0..2) */
  environment: number;
  /** key light color '#rrggbb' */
  color: string;
}

export interface ShadowSettings {
  enabled: boolean;
  /** 0..1 */
  opacity: number;
  /** 0..1 (0 = hard, 1 = very soft) */
  softness: number;
}

export interface ReflectionSettings {
  enabled: boolean;
  /** 0..1 */
  opacity: number;
  /** 0..1 – fraction of the model's height over which the reflection fades out */
  falloff: number;
  /** mm gap between the model and its reflection (0 = touching) */
  gap: number;
}

export interface BackgroundSettings {
  /** Preview background. Exports may still be transparent (see ExportSettings.background). */
  mode: 'transparent' | 'color' | 'gradient';
  color: string;
  color2: string;
}

export interface SceneSettings {
  camera: CameraSettings;
  light: LightSettings;
  shadow: ShadowSettings;
  reflection: ReflectionSettings;
  background: BackgroundSettings;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** true = transparent background (alpha), false = paint SceneSettings.background */
  transparent: boolean;
}

/** Implemented by src/scene/stage/index.ts */
export interface StageAPI {
  /** Show a model (the stage takes ownership and disposes the previous one with disposeObject). */
  setModel(object: THREE.Object3D | null): void;
  applySettings(settings: SceneSettings): void;
  /** Subscribe to camera changes made by mouse/trackpad interaction in the viewport. */
  onCameraChange(cb: (camera: CameraSettings) => void): () => void;
  /**
   * Render the current model + effects off-screen at an exact pixel size, framed to fit
   * the whole composition (model, reflection, shadow), and return a 2D canvas with the pixels.
   * Must restore the on-screen viewport afterwards. Throws an error whose message is meant for the
   * user when it cannot render (no WebGL, lost GPU context, no 2D canvas).
   */
  renderToCanvas(options: RenderOptions): HTMLCanvasElement;
  /**
   * OPTIONAL (animation export): start a turntable render session with ONE fixed framing that fits
   * the union of all frames (the composition never jumps, breathes or gets cropped). The on-screen
   * viewport is frozen until `end()` is called; renderToCanvas() keeps its still-export behavior.
   */
  beginAnimation?(options: AnimationFramingOptions): AnimationRenderSession;
  /** Call when the viewport container is resized (the stage may also observe it itself). */
  resize(): void;
  dispose(): void;
}

/** Options of StageAPI.beginAnimation(). */
export interface AnimationFramingOptions {
  /**
   * Product rotation of every frame in degrees around the vertical axis through the model's center,
   * relative to the current view (+ = counter-clockwise seen from above). Frame i shows angles[i].
   */
  angles: number[];
  /** Pixel size of every rendered frame. */
  width: number;
  height: number;
  /** Apply the viewport's zoom and pan on top of the fixed framing (may crop when zoomed in). */
  useViewZoomPan?: boolean;
}

/** A running turntable render session (see StageAPI.beginAnimation). */
export interface AnimationRenderSession {
  readonly frameCount: number;
  /**
   * Render frame `index` TRANSPARENTLY into `target` (resized to the session size if needed).
   * Throws when the stage changed (model replaced, WebGL context lost) since the session began.
   */
  renderFrame(index: number, target: HTMLCanvasElement): void;
  /** Restore the on-screen viewport. Idempotent – always call it (try/finally). */
  end(): void;
}
