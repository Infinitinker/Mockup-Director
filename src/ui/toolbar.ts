/**
 * Top toolbar (unified macOS-style title bar). The background is a Tauri drag region.
 */
import { h, shortcutLabel } from './dom';
import { ICONS, LOGO_SVG } from './icons';
import { LOCALES, t } from '../i18n';
import type { AppContext } from './context';
import { segmentedControl } from './controls';
import type { Lang } from '../core/types';

export function createToolbar(ctx: AppContext): { el: HTMLElement; render(): void } {
  // "deep": with current Tauri 2.x the whole header (incl. children such as the logo, separators and
  // gaps between buttons) drags the window; buttons/inputs are still excluded by Tauri's drag.js.
  // The per-child attributes below keep older drag.js versions (exact-target match) working too.
  const el = h('header', { class: 'toolbar', attrs: { 'data-tauri-drag-region': 'deep' } });
  let undoBtn: HTMLButtonElement | null = null;
  let redoBtn: HTMLButtonElement | null = null;
  let exportBtn: HTMLButtonElement | null = null;

  const tbButton = (icon: string, text: string, title: string, onClick: () => void) =>
    h(
      'button',
      { class: 'tb-btn', title, label: title, attrs: { type: 'button' }, on: { click: onClick } },
      h('span', { class: 'btn-icon', html: icon }),
      h('span', { class: 'tb-text', text }),
    );

  const updateHistory = () => {
    if (undoBtn) undoBtn.disabled = !ctx.store.canUndo;
    if (redoBtn) redoBtn.disabled = !ctx.store.canRedo;
  };
  const updateBusy = (busy: boolean) => {
    if (!exportBtn) return;
    exportBtn.disabled = busy;
    exportBtn.classList.toggle('busy', busy);
  };

  const render = () => {
    el.replaceChildren();
    const a = ctx.actions;
    undoBtn = tbButton(ICONS.undo, t('undo'), `${t('undo')} (${shortcutLabel('Z')})`, () => a.undo());
    redoBtn = tbButton(ICONS.redo, t('redo'), `${t('redo')} (${shortcutLabel('Z', true)})`, () => a.redo());
    exportBtn = h(
      'button',
      {
        class: 'btn btn-primary tb-export',
        title: `${t('exportImage')} (${shortcutLabel('E')})`,
        attrs: { type: 'button' },
        on: { click: () => void a.exportImage() },
      },
      h('span', { class: 'btn-icon', html: ICONS.exportImg }),
      h('span', { class: 'btn-text', text: t('export') }),
    );
    const lang = segmentedControl<Lang>({
      compact: true,
      ariaLabel: t('language'),
      options: LOCALES.map((l) => ({ value: l.code, label: l.code.toUpperCase(), title: l.name })),
      get: () => ctx.store.state.lang,
      set: (v) => a.setLang(v),
    });
    lang.el.classList.add('tb-lang');
    lang.el.title = t('language');

    el.append(
      h('div', { class: 'tb-traffic', attrs: { 'data-tauri-drag-region': true } }),
      h(
        'div',
        { class: 'tb-brand', attrs: { 'data-tauri-drag-region': true } },
        h('span', { class: 'tb-logo', html: LOGO_SVG, attrs: { 'data-tauri-drag-region': true } }),
        h('span', { class: 'tb-name', text: 'Mockup Director', attrs: { 'data-tauri-drag-region': true } }),
      ),
      h('div', { class: 'tb-sep', attrs: { 'data-tauri-drag-region': true } }),
      h(
        'div',
        { class: 'tb-group', attrs: { 'data-tauri-drag-region': true } },
        tbButton(ICONS.newDoc, t('new'), `${t('newProject')} (${shortcutLabel('N')})`, () => void a.newProject()),
        tbButton(ICONS.open, t('open'), `${t('openProject')} (${shortcutLabel('O')})`, () => void a.openProject()),
        tbButton(ICONS.save, t('save'), `${t('saveProject')} (${shortcutLabel('S')})`, () => void a.saveProject()),
      ),
      h('div', { class: 'tb-sep', attrs: { 'data-tauri-drag-region': true } }),
      h('div', { class: 'tb-group', attrs: { 'data-tauri-drag-region': true } }, undoBtn, redoBtn),
      h('div', { class: 'tb-flex', attrs: { 'data-tauri-drag-region': true } }),
      lang.el,
      exportBtn,
    );
    updateHistory();
    updateBusy(ctx.exportBusy.value);
  };

  ctx.store.onHistoryChange(updateHistory);
  ctx.exportBusy.subscribe(updateBusy);
  render();
  return { el, render };
}
