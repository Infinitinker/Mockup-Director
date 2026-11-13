/**
 * Top toolbar (unified macOS-style title bar). The background is a Tauri drag region.
 */
import { h, shortcutLabel } from '../dom';
import { ICONS, LOGO_SVG } from '../icons';
import type { AppContext } from '../context';
import { version } from '../../../package.json';

export function createToolbar(ctx: AppContext): { el: HTMLElement } {
  // "deep": with current Tauri 2.x the whole header (incl. children such as the logo, separators and
  // gaps between buttons) drags the window; buttons/inputs are still excluded by Tauri's drag.js.
  // The per-child attributes below keep older drag.js versions (exact-target match) working too.
  const el = h('header', { class: 'toolbar', attrs: { 'data-tauri-drag-region': 'deep' } });
  const a = ctx.actions;

  const tbButton = (icon: string, text: string, title: string, onClick: () => void) =>
    h(
      'button',
      { class: 'tb-btn', title, label: title, attrs: { type: 'button' }, on: { click: onClick } },
      h('span', { class: 'btn-icon', html: icon }),
      h('span', { class: 'tb-text', text }),
    );

  const undoBtn = tbButton(ICONS.undo, 'Undo', `Undo (${shortcutLabel('Z')})`, () => a.undo());
  const redoBtn = tbButton(ICONS.redo, 'Redo', `Redo (${shortcutLabel('Z', true)})`, () => a.redo());
  const exportBtn = h(
    'button',
    {
      class: 'btn btn-primary tb-export',
      title: `Export image… (${shortcutLabel('E')})`,
      attrs: { type: 'button' },
      on: { click: () => void a.exportImage() },
    },
    h('span', { class: 'btn-icon', html: ICONS.exportImg }),
    h('span', { class: 'btn-text', text: 'Export…' }),
  );
  el.append(
    h('div', { class: 'tb-traffic', attrs: { 'data-tauri-drag-region': true } }),
    h(
      'div',
      { class: 'tb-brand', title: `Mockup Director ${version}`, attrs: { 'data-tauri-drag-region': true } },
      h('span', { class: 'tb-logo', html: LOGO_SVG, attrs: { 'data-tauri-drag-region': true } }),
      h('span', { class: 'tb-name', text: 'Mockup Director', attrs: { 'data-tauri-drag-region': true } }),
    ),
    h('div', { class: 'tb-sep', attrs: { 'data-tauri-drag-region': true } }),
    h(
      'div',
      { class: 'tb-group', attrs: { 'data-tauri-drag-region': true } },
      tbButton(ICONS.newDoc, 'New', `New project (${shortcutLabel('N')})`, () => void a.newProject()),
      tbButton(ICONS.open, 'Open…', `Open project… (${shortcutLabel('O')})`, () => void a.openProject()),
      tbButton(ICONS.save, 'Save', `Save project (${shortcutLabel('S')})`, () => void a.saveProject()),
      tbButton(
        ICONS.saveAs,
        'Save as…',
        `Save project as… (${shortcutLabel('S', true)})`,
        () => void a.saveProjectAs(),
      ),
    ),
    h('div', { class: 'tb-sep', attrs: { 'data-tauri-drag-region': true } }),
    h('div', { class: 'tb-group', attrs: { 'data-tauri-drag-region': true } }, undoBtn, redoBtn),
    h('div', { class: 'tb-flex', attrs: { 'data-tauri-drag-region': true } }),
    exportBtn,
  );

  const updateHistory = () => {
    undoBtn.disabled = !ctx.store.canUndo;
    redoBtn.disabled = !ctx.store.canRedo;
  };
  const updateBusy = (busy: boolean) => {
    exportBtn.disabled = busy;
    exportBtn.classList.toggle('busy', busy);
  };

  ctx.store.onHistoryChange(updateHistory);
  ctx.exportBusy.subscribe(updateBusy);
  updateHistory();
  updateBusy(ctx.exportBusy.value);
  return { el };
}
