/**
 * How the Export tab's sections read and change the export settings in the store (the still's and the
 * animation's), and how they register the controls the tab syncs.
 */
import type { AnimationSettings, ExportSettings } from '../../../core/types/export';
import { DEFAULT_ANIMATION } from '../../../core/defaults';
import type { AppContext } from '../../context';
import type { Control } from '../../controls';

/** Registers a control so the tab syncs it with the store (in the order they were added), and returns it. */
export type AddControl = <T extends Control>(c: T) => T;

/** The still's export settings. */
export const stillOf = (ctx: AppContext): ExportSettings => ctx.store.state.export;

/** Change the export settings. */
export const updateStill = (ctx: AppContext, fn: (e: ExportSettings) => void): void =>
  ctx.store.update(['export'], (s) => fn(s.export));

/** Current animation settings (defaults until the user changes something). */
export const animationOf = (ctx: AppContext): AnimationSettings => stillOf(ctx).animation ?? DEFAULT_ANIMATION;

/** Mutate the animation settings (created from a COPY of the defaults on first use). */
export const updateAnimation = (ctx: AppContext, fn: (a: AnimationSettings) => void): void =>
  updateStill(ctx, (e) => {
    e.animation ??= { ...DEFAULT_ANIMATION };
    fn(e.animation);
  });
