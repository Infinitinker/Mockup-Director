/**
 * The progress control of the batch export and the animation export: a status text read out by screen
 * readers and a bar from 0 to 100 %.
 */
import { clamp } from '../../core/math';
import { h } from '../dom';

export interface Progress {
  /** The control: the text, then the bar. */
  el: HTMLElement;
  /** Show how far it is (0..1, clamped) and what it is doing. */
  set(fraction: number, text: string): void;
}

/** A progress control at 0 %; `className` and `textClassName` are added to the control's and the text's classes. */
export function createProgress(opts: { className?: string; textClassName?: string } = {}): Progress {
  const text = h('div', {
    class: opts.textClassName ? `anim-progress-text ${opts.textClassName}` : 'anim-progress-text',
    attrs: { 'aria-live': 'polite' },
  });
  const bar = h('div', { class: 'anim-progress-bar' });
  const track = h(
    'div',
    {
      class: 'anim-progress-track',
      attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
    },
    bar,
  );
  const el = h('div', { class: opts.className ? `anim-progress ${opts.className}` : 'anim-progress' }, text, track);
  return {
    el,
    set(fraction, label) {
      const pct = Math.round(clamp(fraction, 0, 1) * 100);
      text.textContent = label;
      bar.style.width = `${pct}%`;
      track.setAttribute('aria-valuenow', String(pct));
      track.setAttribute('aria-valuetext', label);
    },
  };
}
