/**
 * The strip of project tabs above the viewport. It only shows the tabs and reports what the user
 * asks for (activate, close, new); deciding what happens (e.g. asking to save) is up to the caller.
 *
 * Keyboard: the active tab is in the Tab order; Left / Right / Home / End move between tabs,
 * Enter or Space activates the focused one, Delete (on a Mac also the delete key, Backspace) closes
 * it. The close buttons are for the mouse only and hidden from assistive technology, so the tab list
 * holds nothing but tabs.
 */
import type { Documents, TabInfo } from './documents';
import { h, clear, isMac, shortcutLabel, type Signal } from './dom';
import { ICONS } from './icons';

interface TabBarOptions {
  onNew(): void;
  onClose(id: string): void;
  onActivate(id: string): void;
  /** While true (an export runs), tabs cannot be switched, closed or added. */
  busy: Signal<boolean>;
}

/** The name shown for a tab. */
export function tabLabel(tab: TabInfo): string {
  if (tab.name) return tab.name;
  return tab.untitledNumber > 1 ? `Untitled ${tab.untitledNumber}` : 'Untitled';
}

export function createTabBar(docs: Documents, opts: TabBarOptions): { el: HTMLElement } {
  const list = h('div', { class: 'doctabs-list', attrs: { role: 'tablist', 'aria-orientation': 'horizontal' } });
  const newBtn = h('button', {
    class: 'doctabs-new',
    html: ICONS.plus,
    attrs: { type: 'button' },
    on: { click: () => opts.onNew() },
  });
  const el = h('div', { class: 'doctabs' }, list, newBtn);

  /** Tab button by tab id, from the last render. */
  let tabEls = new Map<string, HTMLButtonElement>();
  /** The tab a middle-button press started on (it closes when released over the same tab). */
  let middlePressed: string | null = null;

  const focusTab = (id: string) => tabEls.get(id)?.focus();

  const onTabKey = (e: KeyboardEvent, tab: TabInfo, ids: string[]) => {
    const i = ids.indexOf(tab.id);
    const target =
      e.key === 'ArrowRight'
        ? ids[(i + 1) % ids.length]
        : e.key === 'ArrowLeft'
          ? ids[(i - 1 + ids.length) % ids.length]
          : e.key === 'Home'
            ? ids[0]
            : e.key === 'End'
              ? ids[ids.length - 1]
              : null;
    if (target) {
      e.preventDefault();
      focusTab(target);
    } else if ((e.key === 'Delete' || (isMac && e.key === 'Backspace')) && !opts.busy.value) {
      e.preventDefault();
      opts.onClose(tab.id);
    }
  };

  const renderTab = (tab: TabInfo, ids: string[], busy: boolean) => {
    const label = tabLabel(tab);
    // The • is visual only; the unsaved state is part of the name a screen reader announces.
    const name = tab.dirty ? `${label} (unsaved changes)` : label;
    const button = h(
      'button',
      {
        class: 'doctab-main',
        title: name,
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-label': name,
          'aria-keyshortcuts': isMac ? 'Delete Backspace' : 'Delete',
          'aria-selected': String(tab.active),
          // Roving focus: only the active tab is in the Tab order, the arrows reach the others.
          tabindex: tab.active ? 0 : -1,
          'aria-disabled': busy && !tab.active ? 'true' : null,
        },
        on: {
          click: () => {
            if (!tab.active && !opts.busy.value) opts.onActivate(tab.id);
          },
          keydown: (e) => onTabKey(e, tab, ids),
        },
      },
      h('span', { class: 'doctab-label', text: label }),
    );
    const close = h('button', {
      class: 'doctab-close',
      html: ICONS.close,
      label: 'Close tab',
      title: 'Close tab',
      attrs: { type: 'button', tabindex: -1, disabled: busy },
      on: { click: () => opts.onClose(tab.id) },
    });
    const item = h(
      'div',
      {
        class: `doctab${tab.active ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`,
        attrs: { role: 'presentation', 'data-tab': tab.id },
        on: {
          mousedown: (e) => {
            if (e.button !== 1) return;
            // No auto-scroll cursor on the middle button.
            e.preventDefault();
            middlePressed = tab.id;
          },
          mouseup: (e) => {
            if (e.button !== 1) return;
            const pressed = middlePressed;
            middlePressed = null;
            if (pressed === tab.id && !opts.busy.value) opts.onClose(tab.id);
          },
        },
      },
      button,
      h(
        'span',
        { class: 'doctab-end', attrs: { 'aria-hidden': 'true' } },
        h('span', { class: 'doctab-dirty', text: '•' }),
        close,
      ),
    );
    tabEls.set(tab.id, button);
    return item;
  };

  /** Scrolls the strip (and only the strip) so the active tab is fully visible. */
  const revealActive = () => {
    const item = tabEls.get(docs.activeId)?.parentElement;
    if (!item) return;
    // A little room on both sides keeps the focus ring visible.
    const left = item.offsetLeft - 4;
    const right = item.offsetLeft + item.offsetWidth + 4;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  };

  const render = () => {
    const busy = opts.busy.value;
    const focusedId = [...tabEls].find(([, b]) => b === document.activeElement)?.[0];
    const tabs = docs.tabs();
    const ids = tabs.map((tb) => tb.id);
    tabEls = new Map();
    clear(list);
    list.setAttribute('aria-label', 'Open projects');
    for (const tab of tabs) list.appendChild(renderTab(tab, ids, busy));
    el.classList.toggle('busy', busy);
    newBtn.disabled = busy;
    newBtn.title = `New tab (${shortcutLabel('T')})`;
    newBtn.setAttribute('aria-label', 'New tab');
    // Keep the keyboard focus in the strip across re-renders: on the same tab, or on the active
    // one when the focused tab was closed.
    if (focusedId) focusTab(tabEls.has(focusedId) ? focusedId : docs.activeId);
    revealActive();
  };

  // A mouse wheel scrolls the strip sideways when its tabs do not fit.
  list.addEventListener(
    'wheel',
    (e) => {
      if (list.scrollWidth <= list.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      list.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
  window.addEventListener('mouseup', () => (middlePressed = null));
  // The strip can be narrower than the active tab's position once the window shrinks.
  window.addEventListener('resize', revealActive);

  docs.subscribe(render);
  opts.busy.subscribe(render);
  render();
  return { el };
}
