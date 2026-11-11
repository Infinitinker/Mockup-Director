/**
 * The Scene tab's Preview background section: the mode, and the center and edge colors.
 */
import type { BackgroundSettings } from '../../../core/types/scene';
import type { AppContext } from '../../context';
import { h } from '../../dom';
import type { AddControl } from '../../controls';
import { colorControl } from '../../controls/color';
import { section } from '../../controls/section';
import { segmentedControl } from '../../controls/segmented';
import { sceneOf, updateScene } from './settings';

/** The section; its controls are registered through `add`. */
export function backgroundSection(ctx: AppContext, add: AddControl): HTMLElement {
  const bg = <K extends keyof BackgroundSettings>(k: K, v: BackgroundSettings[K]) =>
    updateScene(ctx, (s) => (s.background = { ...s.background, [k]: v }));
  return section('scene.background', 'Preview background', [
    add(
      segmentedControl<BackgroundSettings['mode']>({
        label: 'Mode',
        options: [
          { value: 'transparent', label: 'Transparent', title: 'Transparent (checkerboard)' },
          { value: 'color', label: 'Color' },
          { value: 'gradient', label: 'Gradient' },
        ],
        get: () => sceneOf(ctx).background.mode,
        set: (v) => bg('mode', v),
      }),
    ).el,
    add(
      colorControl({
        label: 'Color (center)',
        get: () => sceneOf(ctx).background.color,
        set: (v) => bg('color', v),
        disabled: () => sceneOf(ctx).background.mode === 'transparent',
      }),
    ).el,
    add(
      colorControl({
        label: 'Color (edges)',
        get: () => sceneOf(ctx).background.color2,
        set: (v) => bg('color2', v),
        disabled: () => sceneOf(ctx).background.mode !== 'gradient',
      }),
    ).el,
    h('p', {
      class: 'ctl-note',
      text: 'The preview background can also be used for export (Export → Background: As preview).',
    }),
  ]);
}
