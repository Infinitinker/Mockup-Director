/**
 * The Scene tab's Light section: the light preset, direction, elevation, intensity, ambient and environment light,
 * and the light's color.
 */
import type { LightSettings } from '../../../core/types/scene';
import { LIGHT_PRESETS } from '../../../scene/lightPresets';
import type { AppContext } from '../../context';
import type { AddControl } from '../../controls';
import { colorControl } from '../../controls/color';
import { numberControl } from '../../controls/number';
import { section } from '../../controls/section';
import { selectControl } from '../../controls/select';
import { sceneOf, updateScene } from './settings';

/** The select's value when the light is none of the presets; never saved. */
const CUSTOM = '__custom';

/** Whether two lights are the same: each number to within a millionth, the color in any case. */
export function lightEquals(a: LightSettings, b: LightSettings): boolean {
  return (
    Math.abs(a.azimuth - b.azimuth) < 1e-6 &&
    Math.abs(a.elevation - b.elevation) < 1e-6 &&
    Math.abs(a.intensity - b.intensity) < 1e-6 &&
    Math.abs(a.ambient - b.ambient) < 1e-6 &&
    Math.abs(a.environment - b.environment) < 1e-6 &&
    a.color.toLowerCase() === b.color.toLowerCase()
  );
}

/** The section; its controls are registered through `add`. */
export function lightSection(ctx: AppContext, add: AddControl): HTMLElement {
  const presetOptions = [
    { value: CUSTOM, label: 'Custom' },
    ...LIGHT_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  ];
  const lightChildren: (HTMLElement | null)[] = [];
  lightChildren.push(
    add(
      selectControl({
        label: 'Light preset',
        options: presetOptions,
        get: () => LIGHT_PRESETS.find((p) => lightEquals(p.light, sceneOf(ctx).light))?.id ?? CUSTOM,
        set: (id) => {
          const p = LIGHT_PRESETS.find((x) => x.id === id);
          if (!p) return;
          updateScene(ctx, (s) => {
            s.light = { ...p.light };
            if (p.shadow) s.shadow = { ...s.shadow, ...p.shadow };
            if (p.reflection) s.reflection = { ...s.reflection, ...p.reflection };
          });
        },
      }),
    ).el,
  );
  const light = <K extends keyof LightSettings>(k: K, v: LightSettings[K]) =>
    updateScene(ctx, (s) => (s.light = { ...s.light, [k]: v }));
  lightChildren.push(
    add(
      numberControl({
        label: 'Direction (azimuth)',
        min: -180,
        max: 180,
        step: 1,
        unit: '°',
        get: () => sceneOf(ctx).light.azimuth,
        set: (v) => light('azimuth', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Elevation',
        min: 0,
        max: 90,
        step: 1,
        unit: '°',
        get: () => sceneOf(ctx).light.elevation,
        set: (v) => light('elevation', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Intensity',
        min: 0,
        max: 3,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => sceneOf(ctx).light.intensity,
        set: (v) => light('intensity', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Ambient light',
        min: 0,
        max: 2,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => sceneOf(ctx).light.ambient,
        set: (v) => light('ambient', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Environment reflections',
        title: 'Sets how strongly glossy surfaces reflect the studio.',
        min: 0,
        max: 2,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => sceneOf(ctx).light.environment,
        set: (v) => light('environment', v),
      }),
    ).el,
    add(colorControl({ label: 'Light color', get: () => sceneOf(ctx).light.color, set: (v) => light('color', v) })).el,
  );
  return section('scene.light', 'Light', lightChildren);
}
