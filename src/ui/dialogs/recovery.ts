/**
 * The recovery dialog: the stored copies of the projects that were open but could not be reopened
 * (unopened entries, ../../documents/sessionRecords), one row each, where the user saves a copy to a project file
 * or deletes it. A copy the user does neither to is kept and offered again at the next start.
 */
import { saveBlob } from '../../platform/files';
import { panelDialog } from './modal';
import { append, clear, h } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { PROJECT_FILE_FILTER } from '../../project/format';
import { type UnopenedTab, unopenedFileName, unopenedFileText } from '../../documents/sessionRecords';

/** Removes a copy from the app's storage; rejects with a UserError when it stays stored. */
export type ForgetCopy = (id: string) => Promise<void>;

/** Numbers the rows, so the ids their buttons refer to stay unique however often the dialog opens. */
let nextRowId = 0;

const REASON_TEXT: Record<UnopenedTab['reason'], string> = {
  newer: 'From a newer Mockup Director',
  damaged: 'Damaged',
  interrupted: 'Mockup Director closed while reopening it',
};

/** Why the copy was not reopened, and when it was stored if its record says. */
function detailText(copy: UnopenedTab): string {
  const reason = REASON_TEXT[copy.reason];
  if (copy.savedAt === null) return reason;
  const when = new Date(copy.savedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return `${reason} – autosaved ${when}`;
}

/**
 * A small button of a row; its click handler runs the row's action. `describedBy` lists the ids of
 * the texts that say which copy it acts on (and what it does), for screen readers.
 */
function rowButton(label: string, describedBy: string, onClick: () => void, danger = false): HTMLButtonElement {
  return h('button', {
    class: danger ? 'btn btn-small btn-danger' : 'btn btn-small',
    text: label,
    attrs: { type: 'button', 'aria-describedby': describedBy },
    on: { click: onClick },
  });
}

/** One copy: its name, why it was not reopened, its buttons and what became of it. */
function copyRow(copy: UnopenedTab, forget: ForgetCopy): HTMLLIElement {
  const rowId = `recovery-copy-${nextRowId++}`;
  const nameId = `${rowId}-name`;
  const detailId = `${rowId}-detail`;
  const confirmId = `${rowId}-confirm`;
  const describedBy = `${nameId} ${detailId}`;
  const actions = h('div', { class: 'recovery-actions' });
  const status = h('div', { class: 'recovery-status', attrs: { 'aria-live': 'polite' } });
  const row = h(
    'li',
    { class: 'recovery-row' },
    h(
      'div',
      { class: 'recovery-info' },
      h('div', { class: 'recovery-name', text: copy.name || 'Untitled', attrs: { id: nameId } }),
      h('div', { class: 'recovery-detail', text: detailText(copy), attrs: { id: detailId } }),
    ),
    actions,
    status,
  );

  const showStatus = (text: string, detail?: string, error = false) => {
    clear(status);
    status.classList.toggle('is-error', error);
    append(status, h('div', { text }), detail ? h('div', { class: 'recovery-status-detail', text: detail }) : null);
  };
  const setBusy = (busy: boolean) => {
    for (const b of actions.querySelectorAll('button')) b.disabled = busy;
  };
  /** Leaves the row without buttons; focus moves to the dialog's own button. */
  const finish = (text: string) => {
    clear(actions);
    showStatus(text);
    row.closest('.dialog')?.querySelector<HTMLButtonElement>('.dialog-actions .btn')?.focus();
  };

  const showChoices = (focus: 'save' | 'delete' | null = null) => {
    const save = rowButton('Save to file…', describedBy, () => void saveToFile());
    const del = rowButton('Delete…', describedBy, showConfirm);
    clear(actions);
    append(actions, save, del);
    if (focus) (focus === 'save' ? save : del).focus();
  };
  const showConfirm = () => {
    clear(status);
    const note = h('span', { class: 'recovery-confirm', text: 'This cannot be undone.', attrs: { id: confirmId } });
    const confirm = rowButton('Delete for good', `${nameId} ${confirmId}`, () => void deleteCopy(), true);
    clear(actions);
    append(
      actions,
      note,
      rowButton('Cancel', describedBy, () => showChoices('delete')),
      confirm,
    );
    confirm.focus();
  };

  const saveToFile = async () => {
    clear(status);
    setBusy(true);
    let saved: string | null;
    try {
      const blob = new Blob([unopenedFileText(copy.record)], { type: 'application/json' });
      saved = await saveBlob(blob, unopenedFileName(copy.name), [PROJECT_FILE_FILTER], { confirmed: true });
    } catch (e) {
      setBusy(false);
      logShownError('Could not save the copy', e);
      showStatus('Could not save the copy', errorMessage(e), true);
      return;
    }
    if (!saved) {
      setBusy(false);
      return;
    }
    try {
      await forget(copy.id);
    } catch (e) {
      setBusy(false);
      logShownError('Saved a copy, but could not remove it', e);
      showStatus(`Saved as “${saved}”, but the copy could not be removed`, errorMessage(e), true);
      return;
    }
    finish(`Saved as “${saved}”.`);
  };

  const deleteCopy = async () => {
    setBusy(true);
    try {
      await forget(copy.id);
    } catch (e) {
      showChoices('delete');
      logShownError('Could not delete the copy', e);
      showStatus('Could not delete the copy', errorMessage(e), true);
      return;
    }
    finish('Deleted.');
  };

  showChoices();
  return row;
}

/**
 * Shows the copies that could not be reopened, each with Save to file… and Delete…; `forget` removes
 * a copy from the app's storage once it was saved or deleted. Resolves when the dialog is closed.
 */
export function openRecoveryDialog(copies: readonly UnopenedTab[], forget: ForgetCopy): Promise<void> {
  return panelDialog({
    title: 'Some projects that were open could not be reopened',
    message:
      'Mockup Director keeps a copy of each. Save a copy to a file to keep it, or delete it. The copies you leave are kept and offered again at the next start. The ones from a newer Mockup Director open once you update it. To open one that Mockup Director closed while reopening, save it to a file, then open the file.',
    body: h('ul', { class: 'recovery-list' }, ...copies.map((c) => copyRow(c, forget))),
    closeLabel: 'Close',
    className: 'dialog-recovery',
  });
}
