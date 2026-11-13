/**
 * The size controls both export types share: aspect ratio presets, size presets for the longer side, width and
 * height fields that can keep the aspect ratio, and the lock that does it.
 */
import { MAX_EXPORT_SIZE, MIN_ANIMATION_SIZE } from '../../../core/defaults';
import { clamp } from '../../../core/math';
import { maxMarginFor, maxSizeFor } from '../../../export/animation/settings';
import { safeStorage } from '../../../platform/storage';
import type { AppContext } from '../../context';
import type { AddControl, Control } from '../../controls';
import { h, nextId } from '../../dom';
import { ICONS } from '../../icons';
import { animationOf, stillOf, updateAnimation, updateStill } from './settings';

const MIN_SIZE = 16;
const LOCK_KEY = 'mockup-director.ui.lockAspect';

/** An aspect ratio offered as a preset, width : height. */
export interface AspectPreset {
  w: number;
  h: number;
  title: string;
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { w: 1, h: 1, title: 'Square' },
  { w: 4, h: 5, title: 'Portrait' },
  { w: 3, h: 2, title: 'Landscape' },
  { w: 16, h: 9, title: 'Widescreen' },
  { w: 9, h: 16, title: 'Tall, as for stories' },
];

/** The width and height in the ratio of `preset` with `longSide` px on the longer side. */
export function presetSize(longSide: number, preset: AspectPreset): [number, number] {
  return preset.w >= preset.h
    ? [longSide, Math.round((longSide * preset.h) / preset.w)]
    : [Math.round((longSide * preset.w) / preset.h), longSide];
}

/** Whether the size is the aspect preset at its longer side. */
export function hasAspect(width: number, height: number, preset: AspectPreset): boolean {
  const [w, h2] = presetSize(Math.max(width, height), preset);
  return w === width && h2 === height;
}

/** The size scaled so that its longer side is `longSide` px, keeping its aspect ratio. */
export function withLongSide(width: number, height: number, longSide: number): [number, number] {
  const long = Math.max(width, height);
  if (long <= 0) return [longSide, longSide];
  return [Math.round((width * longSide) / long), Math.round((height * longSide) / long)];
}

/** Width / height pair edited by the dimension fields (still image or animation). */
export interface DimTarget {
  get(which: 'width' | 'height'): number;
  set(w: number, h: number): void;
  max(): number;
  min: number;
}

/** Whether the width and height fields keep the aspect ratio; shared by every field and lock button of a tab. */
export interface AspectLock {
  locked: boolean;
}

/** The lock as last stored. */
export function createAspectLock(): AspectLock {
  return { locked: safeStorage.get(LOCK_KEY) !== '0' };
}

/** The still's size. */
export function stillDims(ctx: AppContext): DimTarget {
  const setSize = (w: number, h2: number) =>
    updateStill(ctx, (e) => {
      e.width = Math.round(clamp(w, MIN_SIZE, MAX_EXPORT_SIZE));
      e.height = Math.round(clamp(h2, MIN_SIZE, MAX_EXPORT_SIZE));
      e.margin = Math.min(e.margin, Math.floor(Math.min(e.width, e.height) / 2) - 1);
    });
  return { get: (w) => stillOf(ctx)[w], set: setSize, max: () => MAX_EXPORT_SIZE, min: MIN_SIZE };
}

/** The animation's size, within the limit of its format. */
export function animationDims(ctx: AppContext): DimTarget {
  const setAnimSize = (w: number, h2: number) =>
    updateAnimation(ctx, (a) => {
      const max = maxSizeFor(a.format);
      a.width = Math.round(clamp(w, MIN_ANIMATION_SIZE, max));
      a.height = Math.round(clamp(h2, MIN_ANIMATION_SIZE, max));
      a.margin = Math.min(a.margin, maxMarginFor(a.width, a.height));
    });
  return {
    get: (w) => animationOf(ctx)[w],
    set: setAnimSize,
    max: () => maxSizeFor(animationOf(ctx).format),
    min: MIN_ANIMATION_SIZE,
  };
}

/**
 * The width and height after typing `value` into the `which` field: rounded and clamped to [min, max]; with the
 * lock, the other side scales along; when that passes `max`, both are scaled down to keep it inside.
 */
export function typedSize(
  which: 'width' | 'height',
  value: number,
  current: { width: number; height: number },
  locked: boolean,
  min: number,
  max: number,
): [number, number] {
  const cw = current.width;
  const chh = current.height;
  const v = clamp(Math.round(value), min, max);
  if (which === 'width') {
    let hh = chh;
    if (locked && cw > 0) hh = (chh / cw) * v;
    // Keep the other side inside the limit too (scale both down proportionally).
    if (hh > max) return [(v * max) / hh, max];
    return [v, hh];
  }
  let ww = cw;
  if (locked && chh > 0) ww = (cw / chh) * v;
  if (ww > max) return [max, (v * max) / ww];
  return [ww, v];
}

/** Width/height numeric field with lock-aspect behavior. */
function dimField(which: 'width' | 'height', target: DimTarget, lock: AspectLock): Control {
  const id = nextId('dim');
  const input = h('input', {
    class: 'num-input',
    attrs: { id, type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false' },
  });
  const el = h(
    'div',
    { class: 'dim-field' },
    h('label', { class: 'ctl-label', text: which === 'width' ? 'Width' : 'Height', attrs: { for: id } }),
    h('span', { class: 'num-wrap' }, input, h('span', { class: 'unit', text: 'px' })),
  );
  const commit = () => {
    const n = Number(input.value.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      sync();
      return;
    }
    const current = { width: target.get('width'), height: target.get('height') };
    target.set(...typedSize(which, n, current, lock.locked, target.min, target.max()));
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      input.select();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = Number(input.value) || target.get(which);
      input.value = String(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 100 : 10));
      commit();
    }
  });
  const sync = () => {
    if (document.activeElement !== input) input.value = String(target.get(which));
  };
  sync();
  return { el, sync };
}

function lockButton(lock: AspectLock): HTMLButtonElement {
  const lockBtn = h('button', {
    class: `btn btn-icon-only lock-btn${lock.locked ? ' active' : ''}`,
    html: lock.locked ? ICONS.lock : ICONS.unlock,
    title: 'Lock aspect ratio',
    attrs: { type: 'button', 'aria-pressed': String(lock.locked), 'aria-label': 'Lock aspect ratio' },
    on: {
      click: () => {
        lock.locked = !lock.locked;
        safeStorage.set(LOCK_KEY, lock.locked ? '1' : '0');
        lockBtn.classList.toggle('active', lock.locked);
        lockBtn.innerHTML = lock.locked ? ICONS.lock : ICONS.unlock;
        lockBtn.setAttribute('aria-pressed', String(lock.locked));
      },
    },
  });
  return lockBtn;
}

/** A row of preset chips with its label; `isOn` marks the chip of the current size, `isOff` grays one out. */
function chipRow(
  label: string,
  chips: { text: string; title: string; apply(): void; isOn(): boolean; isOff(): boolean }[],
  add: AddControl,
): HTMLElement {
  const group = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': label } });
  const buttons = chips.map((c) => {
    const b = h('button', {
      class: 'chip',
      text: c.text,
      title: c.title,
      attrs: { type: 'button' },
      on: { click: c.apply },
    });
    group.appendChild(b);
    return b;
  });
  add({
    el: group,
    sync: () =>
      buttons.forEach((b, i) => {
        const c = chips[i];
        if (!c) return;
        const on = c.isOn();
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        b.disabled = c.isOff();
      }),
  });
  return h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', text: label }), group);
}

/** The aspect ratio chips: each keeps the longer side. */
function aspectChips(target: DimTarget, add: AddControl): HTMLElement {
  const size = (): [number, number] => [target.get('width'), target.get('height')];
  return chipRow(
    'Aspect ratio',
    ASPECT_PRESETS.map((p) => ({
      text: `${p.w}:${p.h}`,
      title: p.title,
      apply: () => target.set(...presetSize(Math.max(...size()), p)),
      isOn: () => hasAspect(...size(), p),
      isOff: () => false,
    })),
    add,
  );
}

/** The size chips: each sets the longer side and keeps the aspect ratio; sizes above the target's limit are grayed out. */
function sizeChips(presets: number[], target: DimTarget, add: AddControl): HTMLElement {
  const size = (): [number, number] => [target.get('width'), target.get('height')];
  return chipRow(
    'Size (longer side)',
    presets.map((n) => ({
      text: `${n}`,
      title: `${n} px on the longer side`,
      apply: () => target.set(...withLongSide(...size(), n)),
      isOn: () => Math.max(...size()) === n,
      isOff: () => n > target.max(),
    })),
    add,
  );
}

/**
 * The aspect ratio and size preset rows, and the width × height fields with the lock button; adds the chips and
 * the fields.
 */
export function sizeRows(
  presets: number[],
  target: DimTarget,
  lock: AspectLock,
  add: AddControl,
): { aspects: HTMLElement; sizes: HTMLElement; dims: HTMLElement } {
  const aspects = aspectChips(target, add);
  const sizes = sizeChips(presets, target, add);
  const wField = add(dimField('width', target, lock));
  const hField = add(dimField('height', target, lock));
  const dims = h(
    'div',
    { class: 'dims' },
    wField.el,
    h('span', { class: 'dims-x', text: '×' }),
    hField.el,
    lockButton(lock),
  );
  return { aspects, sizes, dims };
}
