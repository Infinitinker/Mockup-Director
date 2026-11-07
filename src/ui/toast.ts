/**
 * Non-blocking notifications (bottom-centre stack). Errors stay longer and repeated identical
 * messages are de-duplicated (e.g. a model failing on every slider step).
 */
import { h } from './dom';
import { ICONS } from './icons';
import { t } from '../i18n';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

let container: HTMLElement | null = null;
const recent = new Map<string, number>();

export function mountToasts(parent: HTMLElement): void {
  container = h('div', { class: 'toasts', attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' } });
  parent.appendChild(container);
}

export function toast(kind: ToastKind, title: string, detail?: string): void {
  const key = `${kind}|${title}|${detail ?? ''}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < 3000) return;
  recent.set(key, now);
  if (recent.size > 50) recent.clear();

  if (!container) {
    // UI not mounted yet – at least log it.
    (kind === 'error' ? console.error : console.info)(`[mockup-director] ${title}${detail ? ': ' + detail : ''}`);
    return;
  }
  const icon = kind === 'success' ? ICONS.check : kind === 'error' || kind === 'warning' ? ICONS.warn : ICONS.info;
  const el = h(
    'div',
    { class: `toast toast-${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } },
    h('span', { class: 'toast-icon', html: icon }),
    h('div', { class: 'toast-body' }, h('div', { class: 'toast-title', text: title }), detail ? h('div', { class: 'toast-detail', text: detail }) : null),
  );
  const close = h('button', {
    class: 'toast-close',
    html: ICONS.close,
    title: t('close'),
    label: t('close'),
    attrs: { type: 'button' },
    on: { click: () => dismiss() },
  });
  el.appendChild(close);
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
  };
  setTimeout(dismiss, kind === 'error' ? 7000 : kind === 'warning' ? 5500 : 3200);
  // Keep at most 4 toasts on screen.
  while (container.children.length > 4) container.firstElementChild?.remove();
}

export const notify = {
  info: (title: string, detail?: string) => toast('info', title, detail),
  success: (title: string, detail?: string) => toast('success', title, detail),
  warning: (title: string, detail?: string) => toast('warning', title, detail),
  error: (title: string, detail?: string) => toast('error', title, detail),
};
