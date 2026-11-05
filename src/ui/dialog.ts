/**
 * In-app modal dialogs. window.confirm/prompt are not reliable inside WKWebView (the host must
 * implement them), so we draw our own sheet-like dialogs.
 */
import { h } from './dom';
import { t } from './i18n';

interface DialogOptions {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

function openDialog<T>(opts: DialogOptions, body: HTMLElement | null, getResult: () => T, cancelResult: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const ok = h('button', {
      class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`,
      text: opts.okLabel ?? t('ok'),
      attrs: { type: 'submit' },
    });
    const cancel = h('button', { class: 'btn', text: opts.cancelLabel ?? t('cancel'), attrs: { type: 'button' } });
    const form = h(
      'form',
      { class: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
      h('h2', { class: 'dialog-title', text: opts.title, attrs: { id: titleId } }),
      opts.message ? h('p', { class: 'dialog-message', text: opts.message }) : null,
      body,
      h('div', { class: 'dialog-actions' }, cancel, ok),
    );
    const backdrop = h('div', { class: 'modal-backdrop' }, form);

    const close = (result: T) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('show');
      // Let clicks pass through while the fade-out runs.
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 160);
      try {
        prevFocus?.focus();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(cancelResult);
      } else if (e.key === 'Tab') {
        // Simple focus trap.
        const focusables = Array.from(form.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter((x) => !x.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      // Stop global shortcuts while the dialog is open.
      e.stopPropagation();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close(getResult());
    });
    cancel.addEventListener('click', () => close(cancelResult));
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(cancelResult);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));
    const input = form.querySelector<HTMLInputElement>('input');
    if (input) {
      input.focus();
      input.select();
    } else ok.focus();
  });
}

export function confirmDialog(opts: DialogOptions): Promise<boolean> {
  return openDialog(opts, null, () => true, false);
}

export function promptDialog(opts: DialogOptions & { label: string; value?: string; placeholder?: string }): Promise<string | null> {
  const id = `dlg-in-${Math.random().toString(36).slice(2)}`;
  const input = h('input', {
    class: 'text-input',
    attrs: { id, type: 'text', value: opts.value ?? '', placeholder: opts.placeholder ?? '', maxlength: 80, autocomplete: 'off', spellcheck: 'false' },
  });
  const body = h('div', { class: 'dialog-field' }, h('label', { text: opts.label, attrs: { for: id } }), input);
  return openDialog(
    opts,
    body,
    () => {
      const v = input.value.trim();
      return v.length ? v : null;
    },
    null,
  );
}
