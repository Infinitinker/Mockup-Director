/** Tests how the Scene tab's Light section tells which light preset the current light is. */
import { describe, expect, it } from 'vitest';
import type { LightSettings } from '../../../../src/core/types/scene';
import { LIGHT_PRESETS } from '../../../../src/scene/lightPresets';
import { lightEquals } from '../../../../src/ui/panels/scene/light';

const light: LightSettings = {
  azimuth: -35,
  elevation: 45,
  intensity: 1.2,
  ambient: 0.5,
  environment: 1,
  color: '#ffffff',
};
const NUMBERS = ['azimuth', 'elevation', 'intensity', 'ambient', 'environment'] as const;

describe('lightEquals', () => {
  it('treats numbers within a millionth as equal, and not beyond', () => {
    for (const key of NUMBERS) {
      expect(lightEquals(light, { ...light, [key]: light[key] + 5e-7 }), key).toBe(true);
      expect(lightEquals(light, { ...light, [key]: light[key] + 1e-5 }), key).toBe(false);
    }
  });

  it('compares the color in any case', () => {
    expect(lightEquals({ ...light, color: '#FFF7EE' }, { ...light, color: '#fff7ee' })).toBe(true);
    expect(lightEquals({ ...light, color: '#fff7ee' }, { ...light, color: '#ffffff' })).toBe(false);
  });

  it('tells every light preset apart, so the select can show each one', () => {
    for (const preset of LIGHT_PRESETS)
      expect(
        LIGHT_PRESETS.filter((other) => lightEquals(preset.light, other.light)).map((p) => p.id),
        preset.id,
      ).toEqual([preset.id]);
  });
});
