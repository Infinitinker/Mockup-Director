/**
 * The Scene tab's Reflection section: on or off in its header, opacity, falloff and gap.
 */
import type { AppContext } from '../../context';
import type { AddControl } from '../../controls';
import { numberControl } from '../../controls/number';
import { section } from '../../controls/section';
import { headerSwitch } from '../../controls/switch';
import { sceneOf, updateScene } from './settings';

/** The section, with its on or off switch in the header; its controls are registered through `add`. */
export function reflectionSection(ctx: AppContext, add: AddControl): HTMLElement {
  const reflOn = add(
    headerSwitch(
      'Reflection',
      () => sceneOf(ctx).reflection.enabled,
      (v) => updateScene(ctx, (s) => (s.reflection = { ...s.reflection, enabled: v })),
    ),
  );
  const reflOff = () => !sceneOf(ctx).reflection.enabled;
  return section(
    'scene.reflection',
    'Reflection',
    [
      add(
        numberControl({
          label: 'Opacity',
          min: 0,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: reflOff,
          get: () => sceneOf(ctx).reflection.opacity,
          set: (v) => updateScene(ctx, (s) => (s.reflection = { ...s.reflection, opacity: v })),
        }),
      ).el,
      add(
        numberControl({
          label: 'Falloff',
          title: 'The reflection fades out over this part of the model’s height.',
          min: 0.05,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: reflOff,
          get: () => sceneOf(ctx).reflection.falloff,
          set: (v) => updateScene(ctx, (s) => (s.reflection = { ...s.reflection, falloff: v })),
        }),
      ).el,
      add(
        numberControl({
          label: 'Gap',
          min: 0,
          max: 20,
          step: 0.5,
          unit: 'mm',
          inputMax: 100,
          disabled: reflOff,
          get: () => sceneOf(ctx).reflection.gap,
          set: (v) => updateScene(ctx, (s) => (s.reflection = { ...s.reflection, gap: v })),
        }),
      ).el,
    ],
    reflOn.el,
  );
}
