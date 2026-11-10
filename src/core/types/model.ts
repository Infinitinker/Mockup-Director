/**
 * The model contract: what a model definition declares (its parameters, slots and print templates), what it
 * gets to build from (`ModelContext`) and its gallery category.
 *
 * CONVENTIONS (all modules must follow):
 *  - World units are MILLIMETERS.
 *  - A model's root Object3D sits ON the ground plane: its lowest point is at y = 0,
 *    it is centered on x = 0 / z = 0, and its FRONT faces +Z, its top faces +Y.
 *  - Models never mutate shared textures returned by ModelContext.getTexture()
 *    (no changing repeat/offset/rotation/flipY on them). Map image regions via UVs.
 *    If a model really needs a modified copy, it clones the texture and sets
 *    `texture.userData.disposeWithModel = true` so disposeObject() frees it.
 *  - Materials should be MeshStandardMaterial / MeshPhysicalMaterial (the stage sets
 *    scene.environment for realistic reflections; lights are added by the stage).
 *  - Meshes that should cast shadows set `castShadow = true`.
 *  - Camera yaw: 0 = camera on +Z looking at the front; positive yaw moves the camera
 *    toward +X (front + RIGHT side visible). Pitch: positive = camera above, looking down.
 */
import type * as THREE from 'three';
import type { CameraSettings } from './scene';

export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

interface ParamBase {
  id: string;
  label: string;
  /** Optional grouping label for the UI ("Dimensions", "Material", ...). */
  group?: string;
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
  options: { value: string; label: string }[];
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
  label?: string;
}
/** A labeled region on a print template (e.g. "Front", "Spine", "Back"). */
export interface TemplateRegion {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  label: string;
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

/** One slot of a model: a place that takes artwork (a face, a wrap-around cover, a disc label ...). */
export interface ImageSlotDef {
  id: string;
  label: string;
  /** Short help text shown under the slot in the UI. */
  hint?: string;
  /** Expected artwork aspect ratio (width / height) – used by the UI to warn about mismatches. */
  aspect: number;
  /**
   * The slot accepts artwork of ANY aspect ratio (e.g. a screenshot panel whose size follows the artwork).
   * `aspect` then only shapes the placeholder and the UI shows no aspect-mismatch warning.
   */
  anyAspect?: boolean;
  /**
   * Print template description – used to generate a downloadable PNG template.
   * May be a function of the model's current params (e.g. box dimensions).
   */
  template?: PrintTemplate | ((params: ParamValues) => PrintTemplate);
}

export interface ModelContext {
  /** The user's artwork for this slot, or a generated placeholder texture (never null). */
  getTexture(slotId: string): THREE.Texture;
  /** True if the user has provided artwork for the slot. */
  hasArtwork(slotId: string): boolean;
  /** Parameter values (always complete – defaults are filled in). */
  params: ParamValues;
}

export type ModelCategory = 'box' | 'disc' | 'book' | 'print' | 'device';

export interface ModelDefinition {
  id: string;
  category: ModelCategory;
  name: string;
  description?: string;
  /** Inline SVG markup (viewBox 0 0 64 64, use currentColor) used as a gallery icon. */
  icon: string;
  slots: ImageSlotDef[];
  params: ParamDef[];
  /** Suggested initial camera when the model is picked. */
  defaultCamera?: Partial<CameraSettings>;
  /** Build a NEW object tree. Called again whenever params or artwork change. */
  build(ctx: ModelContext): THREE.Object3D;
}
