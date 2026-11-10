/**
 * What a phone or a tablet is made from: the spec each model fills in (size ranges, glass, front and
 * rear camera layout, default finish), how the glass and the screen sit on the body, the body
 * finishes both share, and the camera both open with.
 */

type DeviceKind = 'phone' | 'tablet';

interface Range {
  def: number;
  min: number;
  max: number;
  step: number;
}

interface RearModuleSpec {
  /** Module size (mm) and corner radius, at the default body width. */
  w: number;
  h: number;
  r: number;
  /** Distance of the module from the body's top / side edge (mm). */
  margin: number;
  /** How far the module stands proud of the back (mm). */
  bump: number;
  /** Lens ring radius (mm) and lens centers relative to the module center (portrait, back view irrelevant – symmetric in x). */
  lensR: number;
  lenses: [number, number][];
  /** Flash position relative to the module center (x toward the body center = negative local X). */
  flash: [number, number];
  flashR: number;
}

export interface DeviceSpec {
  kind: DeviceKind;
  width: Range;
  height: Range;
  thickness: Range;
  bezel: Range;
  radius: Range;
  defaultOrientation: 'portrait' | 'landscape';
  /** Front glass thickness and its rounded ("2.5D") top-edge radius, mm. */
  glassT: number;
  glassEdge: number;
  /** Phone: separate frosted back glass of this thickness (0 = metal unibody back). */
  backGlassT: number;
  /** Pixel density used for the recommended screen image size. */
  ppi: number;
  /** Front camera: radius, and which portrait edge it sits on. */
  camR: number;
  camEdge: 'top' | 'right';
  rear: RearModuleSpec;
  defaultFrame: string;
}

/** Inset of the front glass outline from the body outline (leaves a fine seam), mm. */
export const GLASS_INSET = 0.3;
/** Height of the screen above the glass top surface, mm. */
export const SCREEN_LIFT = 0.04;

interface FinishDef {
  label: string;
  frame: string;
  metalness: number;
  roughness: number;
  /** Back color (frosted back glass on phones, anodized back on tablets). */
  back: string;
}

export const FINISHES: Record<string, FinishDef> = {
  graphite: { label: 'Graphite', frame: '#3b3c40', metalness: 0.85, roughness: 0.32, back: '#2f3034' },
  black: { label: 'Black', frame: '#151517', metalness: 0.55, roughness: 0.38, back: '#141416' },
  silver: { label: 'Silver', frame: '#d3d5d8', metalness: 1, roughness: 0.26, back: '#e4e5e4' },
  white: { label: 'White (ceramic)', frame: '#e9e8e4', metalness: 0, roughness: 0.3, back: '#f3f2ee' },
  gold: { label: 'Gold (champagne)', frame: '#d8c29b', metalness: 1, roughness: 0.28, back: '#ece1cc' },
  blue: { label: 'Navy blue', frame: '#3c5374', metalness: 0.8, roughness: 0.32, back: '#46607f' },
  custom: { label: 'Custom color', frame: '#7a7f88', metalness: 0.6, roughness: 0.34, back: '#7a7f88' },
};

/** Front-right 3/4 view from slightly above. */
export const DEVICE_CAMERA = { yaw: 28, pitch: 10 };
