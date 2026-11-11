/**
 * Switches: the switch with its label row, and the small switch without one that sits in a section's header.
 */
import { h, nextId } from '../dom';
import type { Control } from './index';

interface SwitchOpts {
  label: string;
  title?: string;
  get(): boolean;
  set(v: boolean): void;
  disabled?(): boolean;
}

export function switchControl(o: SwitchOpts): Control {
  const id = nextId('sw');
  const input = h('input', { class: 'switch', attrs: { id, type: 'checkbox', role: 'switch' } });
  const el = h(
    'div',
    { class: 'ctl ctl-switch', title: o.title },
    h('label', { class: 'ctl-label', text: o.label, attrs: { for: id } }),
    input,
  );
  input.addEventListener('change', () => o.set(input.checked));
  const sync = () => {
    input.checked = o.get();
    input.setAttribute('aria-checked', String(input.checked));
    const dis = o.disabled?.() ?? false;
    input.disabled = dis;
    el.classList.toggle('is-disabled', dis);
  };
  sync();
  return { el, sync };
}

/** Small switch used in section headers (no label row). */
export function headerSwitch(label: string, get: () => boolean, set: (v: boolean) => void): Control {
  const input = h('input', {
    class: 'switch small',
    attrs: { type: 'checkbox', role: 'switch', 'aria-label': label, title: label },
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', () => set(input.checked));
  const sync = () => {
    input.checked = get();
    input.setAttribute('aria-checked', String(input.checked));
  };
  sync();
  return { el: input, sync };
}
