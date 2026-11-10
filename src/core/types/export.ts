/**
 * Export settings saved with a project: still images (`ExportSettings`) and turntable animations
 * (`AnimationSettings`).
 */

export type AnimationFormat = 'gif' | 'webp' | 'mp4';

/** Turntable animation export settings (stored in ExportSettings.animation). */
export interface AnimationSettings {
  format: AnimationFormat;
  /** Output size in px (GIF / WebP max 1200, MP4 max 1920 – MP4 sizes are rounded down to even). */
  width: number;
  height: number;
  /** Margin in px between the (fixed) composition box and the frame edge. */
  margin: number;
  /** Frames per second (GIF / WebP max 30, MP4 max 60). */
  fps: number;
  /** Length of one loop in seconds (1..20). */
  duration: number;
  /** 'loop' = full 360° turn, 'swing' = back and forth between -swingAngle and +swingAngle. */
  motion: 'loop' | 'swing';
  /** Swing amplitude in degrees (A in ±A). */
  swingAngle: number;
  /** Turn direction seen from above. */
  direction: 'cw' | 'ccw';
  /** Swing easing: 'sine' = ease-in-out (slows down at the turning points), 'linear'. */
  easing: 'sine' | 'linear';
  /** 'transparent' (GIF 1-bit / WebP alpha; MP4 uses white) or 'scene' (preview background). */
  background: 'transparent' | 'scene';
  /** GIF dithering. */
  dither: 'floyd' | 'ordered' | 'none';
  /** GIF palette: one global palette (stable colors, smaller files) or one per frame. */
  palette: 'global' | 'frame';
  /** WebP quality / MP4 bitrate preset. */
  quality: 'low' | 'medium' | 'high';
  /** Use the viewport zoom & pan on top of the fitted framing (off = whole composition, never cropped). */
  useViewZoomPan: boolean;
}

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
   * 'canvas' – output is exactly width x height, composition centered and scaled to fit inside margins.
   * 'trim'   – composition scaled to fit width x height (minus margins), output cropped to the
   *            composition + margins (so one dimension is usually smaller).
   */
  sizing: 'canvas' | 'trim';
  /** 'transparent' (png/webp only; jpeg falls back to white) or 'scene' (use the preview background). */
  background: 'transparent' | 'scene';
  /**
   * Turntable animation settings (optional – older projects have none; see DEFAULT_ANIMATION).
   * Never share this object between documents: copy it (it is mutated in place by the UI).
   */
  animation?: AnimationSettings;
}
