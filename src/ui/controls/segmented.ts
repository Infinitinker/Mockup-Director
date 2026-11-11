/**
 * The segmented control: a radio group of buttons, in which the arrow keys move the selection as in a native
 * radio group.
 */
import { h, nextId } from '../dom';
import type { Control } from './index';

interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  title?: string;
  disabled?: boolean;
}

interface SegmentedOpts<T extends string> {
  label?: string;
  options: SegOption<T>[];
  get(): T;
  set(v: T): void;
  /** Smaller variant without the label row. */
  compact?: boolean;
  /** Accessible name for controls without a visible label. */
  ariaLabel?: string;
  disabled?(): boolean;
}

export function segmentedControl<T extends string>(o: SegmentedOpts<T>): Control {
  const labelId = nextId('seg');
  const group = h('div', {
    class: 'segmented',
    attrs: {
      role: 'radiogroup',
      'aria-labelledby': o.label ? labelId : null,
      'aria-label': o.label ? null : (o.ariaLabel ?? null),
    },
  });
  const buttons = o.options.map((opt) => {
    const b = h(
      'button',
      {
        class: 'seg-btn',
        title: opt.title ?? opt.label,
        attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', disabled: opt.disabled ?? false },
        on: {
          click: () => {
            // Re-clicking the active option must not record a no-op undo step.
            if (opt.disabled || opt.value === o.get()) return;
            o.set(opt.value);
            sync();
          },
        },
      },
      opt.icon ? h('span', { class: 'seg-icon', html: opt.icon }) : null,
      opt.label ? h('span', { text: opt.label }) : null,
    );
    group.appendChild(b);
    return b;
  });
  // Arrow keys move the selection, like native radio groups.
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const enabled = o.options.filter((x) => !x.disabled);
    const idx = enabled.findIndex((x) => x.value === o.get());
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = enabled[(idx + dir + enabled.length) % enabled.length];
    if (next) {
      o.set(next.value);
      sync();
      buttons[o.options.indexOf(next)]?.focus();
    }
  });
  const el = h(
    'div',
    { class: `ctl ctl-seg${o.compact ? ' compact' : ''}` },
    o.label ? h('div', { class: 'ctl-label', text: o.label, attrs: { id: labelId } }) : null,
    group,
  );
  const sync = () => {
    const v = o.get();
    const dis = o.disabled?.() ?? false;
    buttons.forEach((b, i) => {
      const on = o.options[i].value === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.disabled = dis || !!o.options[i].disabled;
    });
    el.classList.toggle('is-disabled', dis);
  };
  sync();
  return { el, sync };
}
