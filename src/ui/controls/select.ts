/**
 * The select control: a drop-down menu with its label.
 */
import { h, nextId } from '../dom';
import type { Control } from './index';

interface SelectOpts {
  label: string;
  options: { value: string; label: string; disabled?: boolean }[];
  get(): string;
  set(v: string): void;
  disabled?(): boolean;
}

export function selectControl(o: SelectOpts): Control {
  const id = nextId('sel');
  const select = h('select', { class: 'select', attrs: { id } });
  for (const opt of o.options)
    select.appendChild(h('option', { text: opt.label, attrs: { value: opt.value, disabled: opt.disabled ?? false } }));
  select.addEventListener('change', () => o.set(select.value));
  const el = h(
    'div',
    { class: 'ctl ctl-select' },
    h('label', { class: 'ctl-label', text: o.label, attrs: { for: id } }),
    select,
  );
  const sync = () => {
    select.value = o.get();
    const dis = o.disabled?.() ?? false;
    select.disabled = dis;
    el.classList.toggle('is-disabled', dis);
  };
  sync();
  return { el, sync };
}
