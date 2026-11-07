/**
 * Left sidebar: model gallery grouped by category.
 */
import { h } from './dom';
import { lt, t, type MessageKey } from '../i18n';
import type { AppContext } from './context';
import { MODELS } from '../models/registry';
import type { ModelCategory } from '../core/types';
import { hasAny } from './state';

const CATEGORY_ORDER: ModelCategory[] = ['box', 'disc', 'book', 'print', 'device'];

const CATEGORY_LABEL: Record<ModelCategory, MessageKey> = {
  box: 'catBoxes',
  disc: 'catDiscs',
  book: 'catBooks',
  print: 'catPrint',
  device: 'catDevices',
};

export function createGallery(ctx: AppContext): { el: HTMLElement; render(): void } {
  const el = h('nav', { class: 'sidebar sidebar-left' });

  const render = () => {
    // Re-rendering replaces the buttons – keep keyboard focus on the selected model.
    const hadFocus = el.contains(document.activeElement);
    el.replaceChildren();
    el.setAttribute('aria-label', t('models'));
    const current = ctx.store.state.modelId;
    const cats = [...CATEGORY_ORDER, ...new Set(MODELS.map((m) => m.category).filter((c) => !CATEGORY_ORDER.includes(c)))];
    for (const cat of cats) {
      const models = MODELS.filter((m) => m.category === cat);
      if (!models.length) continue;
      const list = h('ul', { class: 'gallery-list', attrs: { role: 'list' } });
      for (const m of models) {
        const active = m.id === current;
        const filled = Object.values(ctx.store.state.images[m.id] ?? {}).filter(Boolean).length;
        const btn = h(
          'button',
          {
            class: `gallery-item${active ? ' active' : ''}`,
            title: m.description ? lt(m.description) : lt(m.name),
            attrs: { type: 'button', 'aria-pressed': String(active), 'data-model': m.id },
            on: { click: () => ctx.actions.selectModel(m.id) },
          },
          // model.icon is static SVG markup from our own model modules.
          h('span', { class: 'gallery-icon', html: m.icon }),
          h('span', { class: 'gallery-name', text: lt(m.name) }),
          filled ? h('span', { class: 'gallery-badge', text: String(filled), title: t('imagesAssigned', { n: filled }) }) : null,
        );
        list.appendChild(h('li', {}, btn));
      }
      el.append(h('div', { class: 'sidebar-heading', text: t(CATEGORY_LABEL[cat]) }), list);
    }
    if (hadFocus) el.querySelector<HTMLButtonElement>('.gallery-item.active')?.focus();
  };

  ctx.store.subscribe((e) => {
    if (hasAny(e, 'model', 'lang', 'images')) render();
  });
  render();
  return { el, render };
}
