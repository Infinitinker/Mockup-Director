/**
 * The batch export dialog: the user chooses a mode and its files or views (setup.ts), starts the batch,
 * follows its progress, then saves or discards the ZIP file. While it runs the stage belongs to the batch
 * (BatchHost, src/export/batch/), and Escape cancels instead of closing.
 */
import { runBatch, type BatchHost, type BatchResult, type ItemNote } from '../../export/batch';
import { buildBatchItems } from '../../export/batch/items';
import { zipFileName } from '../../export/fileNames';
import { PROJECT_EXT, readProjectToRender } from '../../project/format';
import { saveBlob } from '../../platform/files';
import type { AppContext } from '../context';
import { append, h, nextFrame, nextId } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { textButton } from '../controls';
import { createProgress } from '../progress';
import { notify } from '../toast';
import {
  addUnique,
  batchRequest,
  defaultSlot,
  isArtworkFile,
  isProjectFile,
  selection,
  storeMode,
  storedMode,
} from './selection';
import { createSetup, type SetupChoice } from './setup';

let dialogOpen = false;

type Phase = 'setup' | 'running' | 'result' | 'saved';

/** Open the batch export dialog (no-op while it is already open). */
export function openBatchDialog(ctx: Pick<AppContext, 'store' | 'stage'>, host: BatchHost): void {
  if (dialogOpen) return;
  dialogOpen = true;

  const choice: SetupChoice = { mode: storedMode(), slotId: defaultSlot(ctx.store.state.modelId) };
  let phase: Phase = 'setup';
  let cancelRequested = false;
  let result: BatchResult | null = null;
  let savedName = '';

  const prevFocus = document.activeElement as HTMLElement | null;
  const titleId = nextId('batch-title');
  const content = h('div', { class: 'batch-content' });
  const actions = h('div', { class: 'dialog-actions' });
  const dialog = h(
    'div',
    { class: 'dialog dialog-batch', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
    h('h2', { class: 'dialog-title', text: 'Batch export', attrs: { id: titleId } }),
    content,
    actions,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);

  // The progress, updated in place while running.
  const progress = createProgress({ className: 'batch-progress', textClassName: 'batch-progress-text' });
  const stoppingNote = h('p', { class: 'ctl-note', text: 'Stopping after the current item…', attrs: { hidden: true } });

  const setProgress = (index: number, total: number, label: string) =>
    progress.set(index / total, `${index + 1} / ${total}: ${label}`);

  const setup = createSetup({
    ctx,
    content,
    actions,
    choice,
    render: () => render(),
    close: () => close(),
    start: () => void start(),
  });

  const renderRunning = () => {
    stoppingNote.hidden = !cancelRequested;
    content.replaceChildren(progress.el, stoppingNote);
    const cancel = textButton('Cancel', '', () => {
      cancelRequested = true;
      cancel.disabled = true;
      stoppingNote.hidden = false;
    });
    cancel.disabled = cancelRequested;
    actions.replaceChildren(cancel);
  };

  const noteList = (title: string, notes: ItemNote[], cls: string): HTMLElement | null => {
    if (!notes.length) return null;
    const list = h('ul', { class: `batch-notes ${cls}` });
    for (const n of notes)
      list.appendChild(h('li', {}, h('strong', { text: n.label }), h('span', { text: `: ${n.message}` })));
    return h('div', { class: 'batch-notes-wrap' }, h('div', { class: 'ctl-label', text: title }), list);
  };

  const renderResult = () => {
    const r = result;
    if (!r) return;
    const status =
      phase === 'saved'
        ? `Saved the ZIP file “${savedName}”.`
        : r.canceled
          ? `Stopped. Done: ${r.done} of ${r.total}.`
          : `Done: ${r.done} of ${r.total}.`;
    content.replaceChildren();
    append(
      content,
      h('p', { class: `batch-status${r.errors.length ? ' has-errors' : ''}`, text: status }),
      r.done === 0 ? h('p', { class: 'ctl-note warn-note', text: 'No images were created.' }) : null,
      noteList(`Errors: ${r.errors.length}`, r.errors, 'is-error'),
      noteList(`Warnings: ${r.warnings.length}`, r.warnings, 'is-warning'),
    );
    if (phase === 'saved' || r.done === 0) {
      actions.replaceChildren(textButton('Close', 'btn-primary', close));
    } else {
      const save = textButton('Save ZIP…', 'btn-primary', () => void saveResult(save));
      actions.replaceChildren(textButton('Discard', '', close), save);
    }
  };

  const render = () => {
    if (phase === 'setup') setup.render();
    else if (phase === 'running') renderRunning();
    else renderResult();
  };

  const start = async () => {
    if (phase !== 'setup') return;
    const items = buildBatchItems(ctx.store.state, batchRequest(choice.mode, choice.slotId), readProjectToRender);
    if (!items.length) return;
    if (!host.begin()) {
      notify.warning('Another export is running. Wait for it to finish.');
      return;
    }
    try {
      phase = 'running';
      cancelRequested = false;
      setProgress(0, items.length, items[0].label);
      render();
      actions.querySelector('button')?.focus();
      result = await runBatch(items, host, ctx.stage, {
        onProgress: (i, label) => setProgress(i, items.length, label),
        isCanceled: () => cancelRequested,
        nextFrame,
        describeError: (label, e) => {
          logShownError(`Batch item ${label} failed`, e);
          return errorMessage(e);
        },
      });
    } catch (e) {
      // runBatch() reports item errors itself; this is an unexpected failure of the batch as a whole.
      logShownError('Batch export failed', e);
      host.end(); // idempotent – runBatch() normally calls host.end() itself
      notify.error('Batch export failed', errorMessage(e));
      result = null;
      phase = 'setup';
      render();
      return;
    }
    phase = 'result';
    render();
    actions.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
  };

  const saveResult = async (btn: HTMLButtonElement) => {
    const r = result;
    if (!r || r.done === 0) return;
    btn.disabled = true;
    try {
      const name = zipFileName();
      const saved = await saveBlob(r.zip.finish(), name, [{ name: 'ZIP', extensions: ['zip'] }]);
      if (!saved) return; // save panel canceled – keep the results
      savedName = saved;
      phase = 'saved';
      notify.success('ZIP file saved', saved);
      render();
      actions.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
    } catch (e) {
      logShownError('Could not save the ZIP file', e);
      notify.error('Could not save the ZIP file', errorMessage(e));
    } finally {
      btn.disabled = false;
    }
  };

  // Drop files onto the dialog.
  dialog.addEventListener('dragover', (e) => {
    if (phase !== 'setup') return;
    e.preventDefault();
    dialog.classList.add('is-drop-target');
  });
  dialog.addEventListener('dragleave', (e) => {
    if (e.target === dialog) dialog.classList.remove('is-drop-target');
  });
  dialog.addEventListener('drop', (e) => {
    e.preventDefault();
    dialog.classList.remove('is-drop-target');
    if (phase !== 'setup') return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const projects = files.filter(isProjectFile);
    const artwork = files.filter((f) => !isProjectFile(f) && isArtworkFile(f));
    if (!projects.length && !artwork.length) {
      notify.warning(`These files are not supported. Drop image files or project files (.${PROJECT_EXT}).`);
      return;
    }
    // Switch to the mode the dropped files belong to. When both kinds are dropped, a file mode that is
    // already shown stays; from "many views" the projects win.
    if (projects.length) selection.projectFiles = addUnique(selection.projectFiles, projects);
    if (artwork.length) selection.artworkFiles = addUnique(selection.artworkFiles, artwork);
    if (!artwork.length) choice.mode = 'projects';
    else if (!projects.length) choice.mode = 'artwork';
    else if (choice.mode === 'views') choice.mode = 'projects';
    storeMode(choice.mode);
    render();
  });

  // Open and close.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (phase === 'setup' || phase === 'saved' || (phase === 'result' && result?.done === 0)) close();
      else if (phase === 'running' && !cancelRequested) {
        cancelRequested = true;
        renderRunning();
      }
      // With unsaved results Escape does nothing – the user chooses Save or Discard explicitly.
    } else if (e.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter(
        (x) => !x.hasAttribute('disabled') && x.tabIndex !== -1,
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus can fall back to <body> when a re-render removes the focused element – pull it back in.
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  function close(): void {
    if (phase === 'running') return;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('show');
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 160);
    result = null; // release the encoded images
    dialogOpen = false;
    try {
      prevFocus?.focus();
    } catch {
      /* ignore */
    }
  }

  // On the document (not the backdrop) so Escape also works when nothing inside the dialog has focus.
  // Global shortcuts ignore keys while a .modal-backdrop is present (see shortcuts.ts).
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && phase === 'setup') close();
  });
  render();
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  (
    actions.querySelector<HTMLButtonElement>('.btn-primary:not(:disabled)') ??
    dialog.querySelector<HTMLElement>('button')
  )?.focus();
}
