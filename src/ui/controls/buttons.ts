/**
 * The icon button and the text button that the panels and dialogs use.
 */
import { h } from '../dom';

/** Icon button helper. */
export function iconButton(
  icon: string,
  label: string,
  onClick: () => void,
  opts: { cls?: string; text?: string; title?: string } = {},
): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn ${opts.cls ?? ''}`.trim(),
      title: opts.title ?? label,
      label,
      attrs: { type: 'button' },
      on: { click: () => onClick() },
    },
    h('span', { class: 'btn-icon', html: icon }),
    opts.text ? h('span', { class: 'btn-text', text: opts.text }) : null,
  );
}

/** Text button helper: a `btn` with the classes in `cls` (may be empty). */
export function textButton(text: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`, text, attrs: { type: 'button', disabled }, on: { click: onClick } });
}
