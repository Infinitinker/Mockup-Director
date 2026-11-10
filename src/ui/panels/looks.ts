/**
 * "Looks" tab: named looks – built-in and the user's own, imported and exported as JSON, with a
 * note when the stored looks could not be read and a warning when they cannot be saved.
 */
import type { Look } from '../../core/types/project';
import { UserError } from '../../core/errors';
import type { AppContext } from '../context';
import { h, nextId } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { ICONS } from '../icons';
import { iconButton } from '../controls/buttons';
import { section } from '../controls/section';
import { confirmDialog, promptDialog } from '../dialog';
import { notify } from '../toast';
import { saveBlob, pickFiles } from '../../platform/files';
import { log } from '../../platform/log';
import { safeStorage } from '../../platform/storage';
import {
  BUILTIN_LOOKS,
  LOOKS_FILE_NAME,
  LooksError,
  MAX_LOOK_NAME,
  NOT_A_LOOKS_FILE,
  applyLook,
  createLooksSaver,
  loadLooks,
  lookFromScene,
  parseLooksFile,
  toLooksFile,
  uniqueName,
} from '../../project/looks';

/** What the Looks tab says when the stored looks are damaged. */
const STORED_LOOKS_DAMAGED =
  'Your saved looks are damaged and could not be read. Until you delete them, looks you save here are not kept after Mockup Director closes: export your looks to a file to keep them.';

/** What the Looks tab says when the stored looks come from a newer version. */
const STORED_LOOKS_NEWER =
  'Your saved looks come from a newer Mockup Director: update Mockup Director to use them. Until then, looks you save here are not kept after Mockup Director closes: export your looks to a file to keep them.';

/** The valid looks of a chosen looks file. Throws a UserError when the file cannot be read. */
async function readLooksFile(f: File): Promise<Look[]> {
  let text: string;
  try {
    text = await f.text();
  } catch (e) {
    throw new UserError(
      'The file could not be read: it may have been moved, deleted or locked. Check that it still exists and can be opened, then import it again.',
      { cause: e },
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LooksError(NOT_A_LOOKS_FILE);
  }
  return parseLooksFile(json);
}

function swatch(look: Look['scene']): HTMLElement {
  const b = look.background;
  const bg =
    b.mode === 'gradient' ? `linear-gradient(180deg, ${b.color}, ${b.color2})` : b.mode === 'color' ? b.color : '';
  return h('span', {
    class: `look-swatch${b.mode === 'transparent' ? ' checkerboard' : ''}`,
    style: bg ? `background:${bg}` : undefined,
    attrs: { 'aria-hidden': 'true' },
  });
}

export function createLooksPanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-looks' });
  const user = loadLooks(safeStorage);
  const looks = user.looks;

  const saver = createLooksSaver(user, safeStorage);
  // One warning while saving keeps failing, not one per change.
  const persist = () => {
    if (saver.save().warn) {
      log.warn('Could not save looks');
      notify.warning(
        'Could not save looks',
        'The storage for looks is full or blocked. Delete looks you no longer need, or export your looks to a file to keep them.',
      );
    }
  };

  const deleteStoredLooks = async () => {
    const ok = await confirmDialog({
      title: 'Delete the saved looks?',
      message: 'This cannot be undone. From then on, your looks are kept after Mockup Director closes.',
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    // An explicit command: its failure is always reported, not only the first time.
    if (saver.replaceDamaged() === 'failed') {
      log.error('Could not delete the saved looks');
      notify.error(
        'Could not delete the saved looks',
        'The storage for looks is full or blocked. Export your looks to a file to keep them.',
      );
    } else {
      notify.success('Deleted the saved looks');
    }
    render();
  };

  // What the user is told when the stored looks could not be read; only damaged ones can be deleted.
  const storedNote = (): HTMLElement | null => {
    if (user.stored === 'ok') return null;
    const note = h('p', {
      class: 'ctl-note warn-note',
      text: user.stored === 'newer' ? STORED_LOOKS_NEWER : STORED_LOOKS_DAMAGED,
    });
    if (user.stored === 'newer') return note;
    return h(
      'div',
      {},
      note,
      h(
        'div',
        { class: 'ctl-actions' },
        iconButton(ICONS.trash, 'Delete saved looks', () => void deleteStoredLooks(), {
          cls: 'btn-small',
          text: 'Delete saved looks',
        }),
      ),
    );
  };

  const apply = (look: Look['scene'], name: string) => {
    const kinds: ('scene' | 'camera')[] = look.camera ? ['scene', 'camera'] : ['scene'];
    ctx.store.update(kinds, (s) => {
      s.scene = applyLook(s.scene, look);
    });
    notify.success(`Applied look “${name}”`);
  };

  const row = (name: string, scene: Look['scene'], index: number | null) => {
    const applyBtn = h(
      'button',
      {
        class: 'look-apply',
        title: 'Apply look',
        attrs: { type: 'button' },
        on: { click: () => apply(scene, name) },
      },
      swatch(scene),
      h('span', { class: 'look-name', text: name }),
      scene.camera ? h('span', { class: 'look-tag', text: '+ camera' }) : null,
    );
    const actions = h('span', { class: 'look-actions' });
    if (index !== null) {
      actions.append(
        iconButton(
          ICONS.pencil,
          'Rename…',
          async () => {
            const v = await promptDialog({
              title: 'Rename look',
              label: 'Look name',
              value: looks[index].name,
              okLabel: 'Rename',
            });
            if (!v) return;
            looks[index] = { ...looks[index], name: uniqueName(v, looks, index) };
            persist();
            render();
          },
          { cls: 'btn-icon-only btn-ghost' },
        ),
        iconButton(
          ICONS.trash,
          'Delete',
          async () => {
            const ok = await confirmDialog({
              title: `Delete look “${looks[index].name}”?`,
              message: 'This cannot be undone.',
              okLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            looks.splice(index, 1);
            persist();
            render();
          },
          { cls: 'btn-icon-only btn-ghost' },
        ),
      );
    }
    return h('li', { class: 'look-row' }, applyBtn, actions);
  };

  const render = () => {
    el.replaceChildren();

    // Save current look.
    const nameId = nextId('pn');
    const camId = nextId('pc');
    const nameInput = h('input', {
      class: 'text-input',
      attrs: {
        id: nameId,
        type: 'text',
        maxlength: MAX_LOOK_NAME,
        placeholder: 'e.g. Bright studio – client X',
        autocomplete: 'off',
      },
    });
    const camInput = h('input', { attrs: { id: camId, type: 'checkbox' } });
    const save = () => {
      const raw = nameInput.value.trim() || 'My look';
      const name = uniqueName(raw, looks);
      looks.push(lookFromScene(name, ctx.store.state.scene, camInput.checked));
      persist();
      notify.success(`Saved look “${name}”`);
      render();
    };
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    const saveButton = h(
      'button',
      { class: 'btn btn-primary btn-small', attrs: { type: 'button' }, on: { click: save } },
      h('span', { class: 'btn-icon', html: ICONS.plus }),
      h('span', { class: 'btn-text', text: 'Save look' }),
    );
    const saveSection = section('looks.save', 'Save current look', [
      h(
        'div',
        { class: 'ctl' },
        h('label', { class: 'ctl-label', text: 'Look name', attrs: { for: nameId } }),
        nameInput,
      ),
      h('label', { class: 'check-row', attrs: { for: camId } }, camInput, h('span', { text: 'Also save the camera' })),
      h('div', { class: 'ctl-actions' }, saveButton),
    ]);

    // The user's looks.
    const userList = h('ul', { class: 'look-list', attrs: { role: 'list' } });
    looks.forEach((look, i) => {
      userList.appendChild(row(look.name, look.scene, i));
    });
    const note = storedNote();
    const userSection = section('looks.user', 'My looks', [
      looks.length
        ? userList
        : note
          ? null
          : h('p', { class: 'empty-state small', text: 'You have no saved looks yet.' }),
      h(
        'div',
        { class: 'ctl-actions' },
        iconButton(ICONS.upload, 'Import looks from a JSON file…', () => void importLooks(), {
          cls: 'btn-small',
          text: 'Import…',
        }),
        iconButton(ICONS.download, 'Export my looks to a JSON file…', () => void exportLooks(), {
          cls: 'btn-small',
          text: 'Export…',
        }),
      ),
    ]);

    // Built-ins.
    const builtinList = h('ul', { class: 'look-list', attrs: { role: 'list' } });
    BUILTIN_LOOKS.forEach((look) => {
      builtinList.appendChild(row(look.name, look.scene, null));
    });
    const builtinSection = section('looks.builtin', 'Built-in looks', [builtinList]);

    // Above every section, so a collapsed section never hides it.
    el.append(...(note ? [note] : []), saveSection, userSection, builtinSection);
  };

  const importLooks = async () => {
    try {
      const files = await pickFiles('.json,application/json', true);
      if (!files.length) return;
      // Read every file before adding any look, so a file that fails leaves the list as it was.
      const imported: Look[] = [];
      for (const f of files) {
        try {
          for (const look of await readLooksFile(f)) {
            imported.push({ ...look, name: uniqueName(look.name, [...looks, ...imported]) });
          }
        } catch (e) {
          logShownError(`Could not import looks from ${f.name}`, e);
          notify.error('Could not import looks', `${f.name}: ${errorMessage(e)}`);
          return;
        }
      }
      if (!imported.length) {
        notify.warning('No looks were found. Choose a looks file exported from the Looks tab.');
        return;
      }
      looks.push(...imported);
      persist();
      render();
      notify.success(`Imported looks: ${imported.length}`);
    } catch (e) {
      logShownError('Could not import looks', e);
      notify.error('Could not import looks', errorMessage(e));
    }
  };

  const exportLooks = async () => {
    try {
      if (!looks.length) {
        notify.info('There are no saved looks to export yet. Save the current look first.');
        return;
      }
      const blob = new Blob([JSON.stringify(toLooksFile(looks), null, 2)], { type: 'application/json' });
      const saved = await saveBlob(blob, LOOKS_FILE_NAME, [{ name: 'JSON', extensions: ['json'] }]);
      if (saved) notify.success('Saved', saved);
    } catch (e) {
      logShownError('Could not export looks', e);
      notify.error('Could not export looks', errorMessage(e));
    }
  };

  render();
  return { el };
}
