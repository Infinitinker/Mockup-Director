/**
 * Right sidebar: tabbed inspector (Artwork / Model / Scene / Export / Looks).
 */
import { h, safeStorage } from './dom';
import type { AppContext, TabId } from './context';
import { createImagesPanel } from './panels/imagesPanel';
import { createModelPanel } from './panels/modelPanel';
import { createScenePanel } from './panels/scenePanel';
import { createExportPanel } from './panels/exportPanel';
import { createStylesPanel } from './panels/stylesPanel';
import { getModel } from '../models/registry';
import { hasAny } from './state';

const TAB_KEY = 'mockup-director.ui.tab';
const TABS: { id: TabId; label: string }[] = [
  { id: 'images', label: 'Artwork' },
  { id: 'model', label: 'Model' },
  { id: 'scene', label: 'Scene' },
  { id: 'export', label: 'Export' },
  { id: 'styles', label: 'Looks' },
];

export function createInspector(ctx: AppContext): { el: HTMLElement; show(tab: TabId): void } {
  const stored = safeStorage.get(TAB_KEY) as TabId | null;
  let active: TabId = TABS.some((x) => x.id === stored) ? (stored as TabId) : 'images';

  const tabBar = h('div', { class: 'tabs', attrs: { role: 'tablist' } });
  const body = h('div', { class: 'tab-panels' });
  const el = h('aside', { class: 'sidebar sidebar-right' }, tabBar, body);

  const panels: Record<TabId, HTMLElement> = {
    images: createImagesPanel(ctx).el,
    model: createModelPanel(ctx).el,
    scene: createScenePanel(ctx).el,
    export: createExportPanel(ctx).el,
    styles: createStylesPanel(ctx).el,
  };
  const buttons = new Map<TabId, HTMLButtonElement>();

  for (const tab of TABS) {
    const panel = panels[tab.id];
    panel.id = `panel-${tab.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
    body.appendChild(panel);
  }

  const imagesBadge = () => {
    const s = ctx.store.state;
    const model = getModel(s.modelId);
    const n = model.slots.filter((sl) => !!s.images[model.id]?.[sl.id]).length;
    return model.slots.length ? `${n}/${model.slots.length}` : '';
  };

  const renderTabs = () => {
    tabBar.replaceChildren();
    tabBar.setAttribute('aria-label', 'Inspector');
    for (const tab of TABS) {
      const b = h(
        'button',
        {
          class: 'tab',
          attrs: { type: 'button', role: 'tab', id: `tab-${tab.id}`, 'aria-controls': `panel-${tab.id}` },
          on: { click: () => show(tab.id) },
        },
        h('span', { text: tab.label }),
        tab.id === 'images' && imagesBadge() ? h('span', { class: 'tab-badge', text: imagesBadge() }) : null,
      );
      buttons.set(tab.id, b);
      tabBar.appendChild(b);
    }
    update();
  };

  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex((x) => x.id === active);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    show(next.id);
    buttons.get(next.id)?.focus();
  });

  const update = () => {
    for (const tab of TABS) {
      const on = tab.id === active;
      const b = buttons.get(tab.id);
      if (b) {
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      panels[tab.id].hidden = !on;
    }
  };

  const show = (tab: TabId) => {
    active = tab;
    safeStorage.set(TAB_KEY, tab);
    update();
    body.scrollTop = 0;
  };

  ctx.store.subscribe((e) => {
    if (hasAny(e, 'model', 'images')) renderTabs();
  });
  renderTabs();
  return { el, show };
}
