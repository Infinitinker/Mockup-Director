/**
 * The Scene tab: its five sections, synced with the store when the scene or the camera changes.
 */
import type { AppContext } from '../../context';
import { h } from '../../dom';
import type { AddControl, Control } from '../../controls';
import { hasAny } from '../../../documents/store';
import { backgroundSection } from './background';
import { cameraSection } from './camera';
import { lightSection } from './light';
import { reflectionSection } from './reflection';
import { shadowSection } from './shadow';

export function createScenePanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-scene' });
  const controls: Control[] = [];
  const add: AddControl = (c) => {
    controls.push(c);
    return c;
  };

  // Built in this order, so the element ids and the order in which the controls sync stay the same.
  const camera = cameraSection(ctx, add);
  const light = lightSection(ctx, add);
  const shadow = shadowSection(ctx, add);
  const reflection = reflectionSection(ctx, add);
  const background = backgroundSection(ctx, add);
  el.append(camera, light, shadow, reflection, background);

  ctx.store.subscribe((e) => {
    if (hasAny(e, 'scene', 'camera'))
      controls.forEach((c) => {
        c.sync();
      });
  });
  return { el };
}
