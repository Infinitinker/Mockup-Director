/**
 * The collapsible inspector section, and which sections are collapsed (kept under `mockup-director.ui.collapsed`).
 */
import { h, nextId } from '../dom';
import { safeStorage } from '../../platform/storage';
import { ICONS } from '../icons';
import { log } from '../../platform/log';

const SECTION_KEY = 'mockup-director.ui.collapsed';
let collapsedCache: Set<string> | null = null;
function collapsedSet(): Set<string> {
  if (collapsedCache) return collapsedCache;
  try {
    const arr = JSON.parse(safeStorage.get(SECTION_KEY) ?? '[]') as unknown;
    collapsedCache = new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch (e) {
    log.warn(`The stored value ${SECTION_KEY} is damaged, so every section is open`, e);
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
