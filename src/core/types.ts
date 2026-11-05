/**
 * Mockup Director – shared contract between modules.
 *
 * CONVENTIONS (all modules must follow):
 *  - World units are MILLIMETRES.
 *  - A model's root Object3D sits ON the ground plane: its lowest point is at y = 0,
 *    it is centred on x = 0 / z = 0, and its FRONT faces +Z, its top faces +Y.
 *  - Models never mutate shared textures returned by ModelContext.getTexture()
 *    (no changing repeat/offset/rotation/flipY on them). Map image regions via UVs.
 *    If a model really needs a modified copy, it clones the texture and sets
 *    `texture.userData.disposeWithModel = true` so disposeObject() frees it.
 *  - Materials should be MeshStandardMaterial / MeshPhysicalMaterial (the stage sets
 *    scene.environment for realistic reflections; lights are added by the stage).
 *  - Meshes that should cast shadows set `castShadow = true`.
 *  - Camera yaw: 0 = camera on +Z looking at the front; positive yaw moves the camera
 *    towards +X (front + RIGHT side visible). Pitch: positive = camera above, looking down.
 */
import type * as THREE from 'three';

export type Lang = 'pl' | 'en';
export interface LocalizedText {
  pl: string;
  en: string;
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

interface ParamBase {
  id: string;
  label: LocalizedText;
  /** Optional grouping label for the UI ("Wymiary", "Materiał", ...). */
  group?: LocalizedText;
}
export interface NumberParamDef extends ParamBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: 'mm' | 'deg' | '%' | '';
}
export interface BooleanParamDef extends ParamBase {
  type: 'boolean';
  default: boolean;
}
export interface SelectParamDef extends ParamBase {
  type: 'select';
  options: { value: string; label: LocalizedText }[];
  default: string;
}
export interface ColorParamDef extends ParamBase {
  type: 'color';
  /** '#rrggbb' */
  default: string;
}
export type ParamDef = NumberParamDef | BooleanParamDef | SelectParamDef | ColorParamDef;

/** A guide line drawn on a print template (positions in mm from the template's top-left). */
export interface TemplateGuide {
  orientation: 'v' | 'h';
  posMm: number;
  label?: LocalizedText;
}
/** A labelled region on a print template (e.g. "Front", "Spine", "Back"). */
export interface TemplateRegion {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  label: LocalizedText;
}
export interface PrintTemplate {
  /** Full artwork size in mm (INCLUDING bleed, if any). */
  widthMm: number;
  heightMm: number;
  /** Bleed in mm on every side (artwork beyond this margin may be cut off). */
  bleedMm?: number;
  guides?: TemplateGuide[];
  regions?: TemplateRegion[];
  /**
   * If set, the template is circular (disc labels): outer and inner (hole) diameter in mm.
   * Optional printOuterMm / printInnerMm give the printable ring when it differs from the
   * generic print-shop convention (e.g. a disc model's inner print diameter / full-face print).
   */
  circle?: { outerMm: number; innerMm: number; printOuterMm?: number; printInnerMm?: number };
}

/** One image input of a model (a face, a wrap-around cover, a disc label ...). */
export interface ImageSlotDef {
  id: string;
  label: LocalizedText;
  /** Short help text shown under the slot in the UI. */
  hint?: LocalizedText;
  /** Expected artwork aspect ratio (width / height) – used by the UI to warn about mismatches. */
  aspect: number;
  /**
   * Print template description – used to generate a downloadable PNG template.
   * May be a function of the model's current params (e.g. box dimensions).
   */
  template?: PrintTemplate | ((params: ParamValues) => PrintTemplate);
}

export interface ModelContext {
  /** The user's image for this slot, or a generated placeholder texture (never null). */
  getTexture(slotId: string): THREE.Texture;
  /** True if the user has provided an image for the slot. */
  hasImage(slotId: string): boolean;
  /** Parameter values (always complete – defaults are filled in). */
  params: ParamValues;
}

export type ModelCategory = 'box' | 'disc';

export interface ModelDefinition {
  id: string;
  category: ModelCategory;
  name: LocalizedText;
  description?: LocalizedText;
  /** Inline SVG markup (viewBox 0 0 64 64, use currentColor) used as a gallery icon. */
  icon: string;
  slots: ImageSlotDef[];
  params: ParamDef[];
  /** Suggested initial camera when the model is picked. */
  defaultCamera?: Partial<CameraSettings>;
  /** Build a NEW object tree. Called again whenever params or images change. */
  build(ctx: ModelContext): THREE.Object3D;
}

/* ------------------------------------------------------------------ */
/* Scene / stage                                                       */
/* ------------------------------------------------------------------ */

export interface CameraSettings {
  /** degrees, 0 = front, + = towards the model's right side */
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
  /** key light colour '#rrggbb' */
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

/** Implemented by src/scene/stage.ts */
export interface StageAPI {
  /** Show a model (the stage takes ownership and disposes the previous one with disposeObject). */
  setModel(object: THREE.Object3D | null): void;
  applySettings(settings: SceneSettings): void;
  /** Subscribe to camera changes made by mouse/trackpad interaction in the viewport. */
  onCameraChange(cb: (camera: CameraSettings) => void): () => void;
  /**
   * Render the current model + effects off-screen at an exact pixel size, framed to fit
   * the whole composition (model, reflection, shadow), and return a 2D canvas with the pixels.
   * Must restore the on-screen viewport afterwards.
   */
  renderToCanvas(options: RenderOptions): HTMLCanvasElement;
  /** Call when the viewport container is resized (the stage may also observe it itself). */
  resize(): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportSettings {
  /** Output canvas size in px (max 4000 each). */
  width: number;
  height: number;
  /** Margin in px between the composition's bounding box and the image edge. */
  margin: number;
  format: ExportFormat;
  /** 0..1 for jpeg / webp */
  quality: number;
  /**
   * 'canvas' – output is exactly width x height, composition centred and scaled to fit inside margins.
   * 'trim'   – composition scaled to fit width x height (minus margins), output cropped to the
   *            composition + margins (so one dimension is usually smaller).
   */
  sizing: 'canvas' | 'trim';
  /** 'transparent' (png/webp only; jpeg falls back to white) or 'scene' (use the preview background). */
  background: 'transparent' | 'scene';
}

/* ------------------------------------------------------------------ */
/* Images / project                                                    */
/* ------------------------------------------------------------------ */

export interface ImageAsset {
  name: string;
  /** data: URL of the original file (kept for project saving). */
  dataUrl: string;
  width: number;
  height: number;
  texture: THREE.Texture;
}

/** Serialisable project file (*.mockup, JSON). */
export interface ProjectFile {
  app: 'mockup-director';
  version: 1;
  modelId: string;
  params: Record<string, ParamValues>;
  /** modelId -> slotId -> image */
  images: Record<string, Record<string, { name: string; dataUrl: string }>>;
  scene: SceneSettings;
  export: ExportSettings;
}

/** Named, reusable look (stored in localStorage). */
export interface ScenePreset {
  name: string;
  scene: Omit<SceneSettings, 'camera'> & { camera?: CameraSettings };
}
