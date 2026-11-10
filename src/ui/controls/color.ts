/**
 * The color control: the native color picker and a hex field that accepts #rgb and #rrggbb.
 */
import { h, nextId } from '../dom';
import type { Control } from './index';

interface ColorOpts {
  label: string;
  get(): string;
  set(v: string): void;
  disabled?(): boolean;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/** A typed color as lowercase `#rrggbb` (the `#` is optional, `#rgb` is widened), or null if it is not one. */
export function normalizeHex(v: string): string | null {
  const s = v.trim();
  const m6 = HEX6.exec(s);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = HEX3.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  return null;
}

export function colorControl(o: ColorOpts): Control {
  const id = nextId('col');
  const picker = h('input', { class: 'color-swatch', attrs: { type: 'color', 'aria-label': o.label } });
  const hex = h('input', {
    class: 'hex-input',
    attrs: { id, type: 'text', maxlength: 7, autocomplete: 'off', spellcheck: 'false' },
  });
  const el = h(
    'div',
    { class: 'ctl ctl-color' },
    h('label', { class: 'ctl-label', text: o.label, attrs: { for: id } }),
    h('span', { class: 'color-wrap' }, picker, hex),
  );
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    o.set(picker.value.toLowerCase());
  });
  const commitHex = () => {
    const n = normalizeHex(hex.value);
    if (n) {
      o.set(n);
    }
    sync();
  };
  hex.addEventListener('change', commitHex);
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitHex();
      hex.blur();
    }
  });
  const sync = () => {
    const v = normalizeHex(o.get()) ?? '#000000';
    picker.value = v;
    if (document.activeElement !== hex) hex.value = v;
    const dis = o.disabled?.() ?? false;
    picker.disabled = dis;
    hex.disabled = dis;
    el.classList.toggle('is-disabled', dis);
  };
  sync();
  return { el, sync };
}
