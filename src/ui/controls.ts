/**
 * Inspector controls (slider + numeric field, switch, segmented control, select, color) and
 * collapsible sections. Each control reads its value through `get()` and writes through `set()`;
 * `sync()` refreshes the DOM from the state without rebuilding it (keeps focus & drag state).
 */
import { clamp } from '../core/math';
import { h, nextId } from './dom';
import { safeStorage } from '../platform/storage';
import { ICONS } from './icons';
import { formatNumber, parseNumber } from './numbers';

export interface Control {
  el: HTMLElement;
  sync(): void;
}

/* ------------------------------------------------------------------ */
/* Number: label + numeric field on top, slider below                  */
/* ------------------------------------------------------------------ */

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

function decimalsFor(step: number): number {
  if (!(step > 0)) return 0;
  // Decimals of the step as written (0.25 -> 2, 0.1 -> 1, 5 -> 0); guard float noise like 0.30000000000000004.
  const str = String(Number(step.toPrecision(6)));
  if (str.includes('e-')) return 4;
  return clamp((str.split('.')[1] ?? '').length, 0, 4);
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

/* ------------------------------------------------------------------ */
/* Switch                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Segmented control (radio group)                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Color: native picker + hex field                                    */
/* ------------------------------------------------------------------ */

interface ColorOpts {
  label: string;
  get(): string;
  set(v: string): void;
  disabled?(): boolean;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;

function normalizeHex(v: string): string | null {
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

/* ------------------------------------------------------------------ */
/* Collapsible section                                                 */
/* ------------------------------------------------------------------ */

const SECTION_KEY = 'mockup-director.ui.collapsed';
let collapsedCache: Set<string> | null = null;
function collapsedSet(): Set<string> {
  if (collapsedCache) return collapsedCache;
  try {
    const arr = JSON.parse(safeStorage.get(SECTION_KEY) ?? '[]') as unknown;
    collapsedCache = new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    collapsedCache = new Set();
  }
  return collapsedCache;
}

/**
 * Collapsible inspector section. `key` identifies it for remembering the collapsed state.
 * `extra` is an optional element shown at the right of the header (e.g. an on/off switch).
 */
export function section(
  key: string,
  title: string,
  children: (HTMLElement | null)[],
  extra?: HTMLElement,
): HTMLElement {
  const bodyId = nextId('sec');
  const collapsed = collapsedSet().has(key);
  const toggle = h(
    'button',
    {
      class: 'section-toggle',
      attrs: { type: 'button', 'aria-expanded': String(!collapsed), 'aria-controls': bodyId },
    },
    h('span', { class: 'chev', html: ICONS.chevron }),
    h('span', { class: 'section-title', text: title }),
  );
  const body = h('div', { class: 'section-body', attrs: { id: bodyId } });
  for (const c of children) if (c) body.appendChild(c);
  const el = h(
    'section',
    { class: `section${collapsed ? ' collapsed' : ''}` },
    h('div', { class: 'section-head' }, toggle, extra ?? null),
    body,
  );
  toggle.addEventListener('click', () => {
    const set = collapsedSet();
    const now = !el.classList.contains('collapsed');
    el.classList.toggle('collapsed', now);
    toggle.setAttribute('aria-expanded', String(!now));
    if (now) set.add(key);
    else set.delete(key);
    safeStorage.set(SECTION_KEY, JSON.stringify([...set]));
  });
  return el;
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

/** Icon button helper. */
export function iconButton(
  icon: string,
  label: string,
  onClick: () => void,
  opts: { cls?: string; text?: string; title?: string } = {},
): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn ${opts.cls ?? ''}`.trim(),
      title: opts.title ?? label,
      label,
      attrs: { type: 'button' },
      on: { click: () => onClick() },
    },
    h('span', { class: 'btn-icon', html: icon }),
    opts.text ? h('span', { class: 'btn-text', text: opts.text }) : null,
  );
}
