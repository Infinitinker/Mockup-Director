/**
 * The Scene tab's Shadow section: on or off in its header, opacity and softness.
 */
import type { AppContext } from '../../context';
import type { AddControl } from '../../controls';
import { numberControl } from '../../controls/number';
import { section } from '../../controls/section';
import { headerSwitch } from '../../controls/switch';
import { sceneOf, updateScene } from './settings';

/** The section, with its on or off switch in the header; its controls are registered through `add`. */
export function shadowSection(ctx: AppContext, add: AddControl): HTMLElement {
  const shadowOn = add(
    headerSwitch(
      'Shadow',
      () => sceneOf(ctx).shadow.enabled,
      (v) => updateScene(ctx, (s) => (s.shadow = { ...s.shadow, enabled: v })),
    ),
  );
  const shadowOff = () => !sceneOf(ctx).shadow.enabled;
  return section(
    'scene.shadow',
    'Shadow',
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
          disabled: shadowOff,
          get: () => sceneOf(ctx).shadow.opacity,
          set: (v) => updateScene(ctx, (s) => (s.shadow = { ...s.shadow, opacity: v })),
        }),
      ).el,
      add(
        numberControl({
          label: 'Softness',
          min: 0,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: shadowOff,
          get: () => sceneOf(ctx).shadow.softness,
          set: (v) => updateScene(ctx, (s) => (s.shadow = { ...s.shadow, softness: v })),
        }),
      ).el,
    ],
    shadowOn.el,
  );
}
