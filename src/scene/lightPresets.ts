/**
 * Built-in lighting looks. Key light azimuth is relative to the camera (0 = from the viewer,
 * negative = from the left, positive = from the right, 180 = from behind); elevation is the
 * angle above the floor. See stage.ts for how the values map to the actual lights.
 */
import type { LightSettings, LocalizedText, ReflectionSettings, ShadowSettings } from '../core/types';
import { L } from '../i18n';

export interface LightPreset {
  id: string;
  label: LocalizedText;
  light: LightSettings;
  shadow?: Partial<ShadowSettings>;
  reflection?: Partial<ReflectionSettings>;
}

export const LIGHT_PRESETS: LightPreset[] = [
  {
    id: 'studio',
    label: L('Studio'),
    light: { azimuth: -35, elevation: 45, intensity: 1.2, ambient: 0.5, environment: 1, color: '#ffffff' },
    shadow: { enabled: true, opacity: 0.45, softness: 0.5 },
    reflection: { opacity: 0.25 },
  },
  {
    id: 'soft',
    label: L('Soft light'),
    light: { azimuth: -20, elevation: 55, intensity: 0.75, ambient: 0.8, environment: 1.2, color: '#ffffff' },
    shadow: { enabled: true, opacity: 0.35, softness: 0.85 },
    reflection: { opacity: 0.2 },
  },
  {
    id: 'dramatic',
    label: L('Dramatic'),
    light: { azimuth: -70, elevation: 30, intensity: 2.1, ambient: 0.12, environment: 0.45, color: '#fff7ee' },
    shadow: { enabled: true, opacity: 0.6, softness: 0.3 },
    reflection: { opacity: 0.35 },
  },
  {
    id: 'flat',
    label: L('Flat (catalogue)'),
    light: { azimuth: 0, elevation: 35, intensity: 0.5, ambient: 1.0, environment: 1.3, color: '#ffffff' },
    shadow: { enabled: true, opacity: 0.3, softness: 0.8 },
    reflection: { enabled: false },
  },
  {
    id: 'top',
    label: L('Top light'),
    light: { azimuth: 0, elevation: 82, intensity: 1.4, ambient: 0.4, environment: 0.9, color: '#ffffff' },
    shadow: { enabled: true, opacity: 0.55, softness: 0.35 },
  },
  {
    id: 'rim',
    label: L('Rim light'),
    light: { azimuth: 150, elevation: 35, intensity: 1.8, ambient: 0.45, environment: 1.1, color: '#ffffff' },
    shadow: { enabled: true, opacity: 0.4, softness: 0.6 },
    reflection: { opacity: 0.3 },
  },
  {
    id: 'warm',
    label: L('Warm'),
    light: { azimuth: -40, elevation: 40, intensity: 1.3, ambient: 0.5, environment: 0.9, color: '#ffe4c4' },
    shadow: { enabled: true, opacity: 0.45, softness: 0.55 },
  },
  {
    id: 'cool',
    label: L('Cool'),
    light: { azimuth: 35, elevation: 45, intensity: 1.2, ambient: 0.55, environment: 1.05, color: '#dde8ff' },
    shadow: { enabled: true, opacity: 0.45, softness: 0.5 },
  },
];
