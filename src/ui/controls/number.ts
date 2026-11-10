/**
 * The number control: the label and a number field on top, a slider below. Typed values may have a wider range
 * than the slider.
 */
import { clamp } from '../../core/math';
import { h, nextId } from '../dom';
import { decimalsFor, formatNumber, parseNumber } from '../numbers';
import type { Control } from './index';

interface NumberOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Unit shown after the field ('mm', '°', '%', 'px' ...). */
  unit?: string | undefined;
  /** Display value = stored value * factor (e.g. 100 to show 0..1 as %). */
  factor?: number;
  /** Decimals shown in the field (default derived from step). */
  decimals?: number;
  /** Allowed range for typed values (defaults to min/max). The slider always uses min/max. */
  inputMin?: number;
  inputMax?: number;
  title?: string;
  get(): number;
  set(v: number): void;
  disabled?(): boolean;
}

export function numberControl(o: NumberOpts): Control {
  const factor = o.factor ?? 1;
  const dMin = o.min * factor;
  const dMax = o.max * factor;
  const dStep = o.step * factor;
  const decimals = o.decimals ?? decimalsFor(dStep);
  const iMin = (o.inputMin ?? o.min) * factor;
  const iMax = (o.inputMax ?? o.max) * factor;
  const id = nextId('num');

  const range = h('input', {
    class: 'range',
    attrs: { type: 'range', min: dMin, max: dMax, step: dStep, 'aria-label': o.label, tabindex: -1 },
  });
  const field = h('input', {
    class: 'num-input',
    attrs: { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' },
  });
  const unit = o.unit ? h('span', { class: 'unit', text: o.unit }) : null;
  const el = h(
    'div',
    { class: 'ctl ctl-number', title: o.title },
    h(
      'div',
      { class: 'ctl-row' },
      h('label', { class: 'ctl-label', text: o.label, attrs: { for: id } }),
      h('span', { class: 'num-wrap' }, field, unit),
    ),
    range,
  );

  const updateFill = (dv: number) => {
    const p = dMax > dMin ? ((clamp(dv, dMin, dMax) - dMin) / (dMax - dMin)) * 100 : 0;
    range.style.setProperty('--fill', `${p}%`);
  };
  const show = (v: number) => {
    const dv = v * factor;
    range.value = String(clamp(dv, dMin, dMax));
    updateFill(dv);
    if (document.activeElement !== field) field.value = formatNumber(dv, decimals);
  };
  const commit = (dv: number) => {
    const clamped = clamp(dv, iMin, iMax);
    o.set(clamped / factor);
    show(o.get());
  };

  range.addEventListener('input', () => {
    const dv = Number(range.value);
    updateFill(dv);
    field.value = formatNumber(dv, decimals);
    o.set(dv / factor);
  });
  field.addEventListener('change', () => {
    const n = parseNumber(field.value);
    if (n === null) show(o.get());
    else commit(n);
  });
  field.addEventListener('blur', () => show(o.get()));
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      field.blur();
    } else if (e.key === 'Escape') {
      show(o.get());
      field.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseNumber(field.value) ?? o.get() * factor;
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * dStep * (e.shiftKey ? 10 : 1);
      const next = Math.round((cur + delta) / dStep) * dStep;
      commit(next);
      field.value = formatNumber(o.get() * factor, decimals);
    }
  });
  const sync = () => {
    const dis = o.disabled?.() ?? false;
    range.disabled = dis;
    field.disabled = dis;
    el.classList.toggle('is-disabled', dis);
    show(o.get());
  };
  sync();
  return { el, sync };
}
