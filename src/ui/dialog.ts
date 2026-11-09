/**
 * In-app modal dialogs. window.confirm/prompt are not reliable inside WKWebView (the host must
 * implement them), so we draw our own sheet-like dialogs.
 */
import { h } from './dom';
import { t } from '../i18n';

interface DialogOptions {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogButton<T> {
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** The button Enter presses and the first focus goes to (unless the dialog has a text field). */
  isDefault?: boolean;
  result: () => T;
}

function openDialog<T>(
  content: { title: string; message?: string; body?: HTMLElement },
  buttons: DialogButton<T>[],
  cancelResult: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const defaultButton = buttons.find((b) => b.isDefault);
    const buttonEls = buttons.map((b) => {
      const kind = b.danger ? ' btn-danger' : b.primary ? ' btn-primary' : '';
      const el = h('button', {
        class: `btn${kind}`,
        text: b.label,
        attrs: { type: b === defaultButton ? 'submit' : 'button' },
      });
      if (b !== defaultButton) el.addEventListener('click', () => close(b.result()));
      return el;
    });
    const form = h(
      'form',
      { class: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
      h('h2', { class: 'dialog-title', text: content.title, attrs: { id: titleId } }),
      content.message ? h('p', { class: 'dialog-message', text: content.message }) : null,
      content.body,
      h('div', { class: 'dialog-actions' }, ...buttonEls),
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
        const focusables = Array.from(form.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(
          (x) => !x.hasAttribute('disabled'),
        );
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
      if (defaultButton) close(defaultButton.result());
    });
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
    } else (buttonEls[defaultButton ? buttons.indexOf(defaultButton) : buttonEls.length - 1] ?? form).focus();
  });
}

/** Cancel and OK buttons; OK is the default. */
function okCancel<T>(opts: DialogOptions, ok: () => T, cancel: T): DialogButton<T>[] {
  return [
    { label: opts.cancelLabel ?? t('cancel'), result: () => cancel },
    { label: opts.okLabel ?? t('ok'), primary: !opts.danger, danger: opts.danger, isDefault: true, result: ok },
  ];
}

export function confirmDialog(opts: DialogOptions): Promise<boolean> {
  return openDialog(
    opts,
    okCancel(opts, () => true, false),
    false,
  );
}

export function promptDialog(
  opts: DialogOptions & { label: string; value?: string; placeholder?: string },
): Promise<string | null> {
  const id = `dlg-in-${Math.random().toString(36).slice(2)}`;
  const input = h('input', {
    class: 'text-input',
    attrs: {
      id,
      type: 'text',
      value: opts.value ?? '',
      placeholder: opts.placeholder ?? '',
      maxlength: 80,
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  const body = h('div', { class: 'dialog-field' }, h('label', { text: opts.label, attrs: { for: id } }), input);
  const value = () => {
    const v = input.value.trim();
    return v.length ? v : null;
  };
  return openDialog({ ...opts, body }, okCancel(opts, value, null), null);
}

export interface DialogChoice {
  id: string;
  label: string;
  /** The default choice: highlighted, focused first and pressed by Enter. */
  primary?: boolean;
  danger?: boolean;
}

/**
 * A dialog with its own buttons, shown in the given order. Resolves with the id of the chosen
 * button, or null when the dialog is dismissed (Escape or a click outside it).
 */
export function choiceDialog(opts: {
  title: string;
  message?: string;
  choices: DialogChoice[];
}): Promise<string | null> {
  const buttons = opts.choices.map(
    (c): DialogButton<string | null> => ({
      label: c.label,
      primary: c.primary,
      danger: c.danger,
      isDefault: c.primary,
      result: () => c.id,
    }),
  );
  return openDialog(opts, buttons, null);
}
