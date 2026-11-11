/**
 * The animation export's progress in the Export tab: what each phase says, how far it is, and Cancel.
 */
import type { AnimationProgress } from '../../../export/animation';
import type { AppContext } from '../../context';
import { h } from '../../dom';
import { createProgress } from '../../controls/progress';

/** The text and the fraction done (not clamped) of a progress report. */
export function describeProgress(p: AnimationProgress): { text: string; fraction: number } {
  switch (p.phase) {
    case 'palette':
      return { text: `Analyzing colors: ${p.done} / ${p.total}`, fraction: p.total ? (0.1 * p.done) / p.total : 0 };
    case 'frames':
      return {
        text: `Frames rendered & encoded: ${p.done} / ${p.total}`,
        fraction: 0.1 + (p.total ? (0.85 * p.done) / p.total : 0),
      };
    case 'finalize':
      return { text: 'Finishing the file…', fraction: p.done ? 1 : 0.95 };
    default:
      return { text: 'Preparing…', fraction: 0 };
  }
}

/** The progress with its Cancel button, hidden while no animation export runs. */
export function createAnimationProgress(ctx: AppContext): {
  el: HTMLElement;
  update(p: AnimationProgress | null): void;
} {
  const progress = createProgress();
  const cancelBtn = h('button', {
    class: 'btn anim-cancel',
    text: 'Cancel',
    attrs: { type: 'button' },
    on: { click: () => ctx.actions.cancelAnimation() },
  });
  const el = progress.el;
  el.append(cancelBtn);
  el.hidden = true;
  return {
    el,
    update(p) {
      el.hidden = !p;
      if (!p) return;
      const { text, fraction } = describeProgress(p);
      progress.set(fraction, text);
    },
  };
}
