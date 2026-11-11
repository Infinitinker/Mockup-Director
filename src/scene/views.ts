/**
 * The preset camera views of the view bar and the keys 1–6.
 */

interface ViewPreset {
  label: string;
  yaw: number;
  pitch: number;
}

/** Preset camera views (keyboard 1–6), in the order of the view bar. */
export const VIEW_PRESETS: ViewPreset[] = [
  { label: 'Front', yaw: 0, pitch: 0 },
  { label: '3/4 left', yaw: -30, pitch: 12 },
  { label: '3/4 right', yaw: 30, pitch: 12 },
  { label: 'Side', yaw: 90, pitch: 5 },
  { label: 'Top', yaw: 0, pitch: 60 },
  { label: 'Back', yaw: 180, pitch: 10 },
];
