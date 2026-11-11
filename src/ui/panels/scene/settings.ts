/**
 * How the Scene tab's sections read and change the scene settings in the store.
 */
import type { SceneSettings } from '../../../core/types/scene';
import type { AppContext } from '../../context';

/** The scene settings. */
export const sceneOf = (ctx: AppContext): SceneSettings => ctx.store.state.scene;

/** Change the scene settings. */
export const updateScene = (ctx: AppContext, fn: (s: SceneSettings) => void): void =>
  ctx.store.update(['scene'], (s) => fn(s.scene));
