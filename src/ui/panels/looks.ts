/**
 * "Looks" tab: named looks – built-in and the user's own, imported and exported as JSON.
 */
import type { Look } from '../../core/types';
import type { AppContext } from '../context';
import { errorMessage, h, nextId } from '../dom';
import { ICONS } from '../icons';
import { iconButton, section } from '../controls';
import { confirmDialog, promptDialog } from '../dialog';
import { notify } from '../toast';
import { saveBlob, pickFiles } from '../../platform/files';
import {
  BUILTIN_LOOKS,
  LOOKS_FILE_NAME,
  LooksError,
  MAX_LOOK_NAME,
  NOT_A_LOOKS_FILE,
  applyLook,
  loadLooks,
  lookFromScene,
  parseLooksFile,
  saveLooks,
  toLooksFile,
  uniqueName,
} from '../looks';

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
  let stored = loadLooks();
  let looks = stored.looks;

  // Looks from a newer version are never overwritten.
  const persist = () => {
    if (!stored.locked) saveLooks(looks);
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
    stored = loadLooks();
    looks = stored.looks;

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
      if (stored.locked) return;
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
    saveButton.disabled = stored.locked;
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
    const importButton = iconButton(ICONS.upload, 'Import looks from a JSON file…', () => void importLooks(), {
      cls: 'btn-small',
      text: 'Import…',
    });
    importButton.disabled = stored.locked;
    const userSection = section('looks.user', 'My looks', [
      stored.error
        ? h('p', { class: 'ctl-note warn-note', text: stored.error })
        : looks.length
          ? userList
          : h('p', { class: 'empty-state small', text: 'You have no saved looks yet.' }),
      h(
        'div',
        { class: 'ctl-actions' },
        importButton,
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

    el.append(saveSection, userSection, builtinSection);
  };

  const importLooks = async () => {
    if (stored.locked) return;
    try {
      const files = await pickFiles('.json,application/json', true);
      if (!files.length) return;
      // Read every file before adding any look, so a file that fails leaves the list as it was.
      const imported: Look[] = [];
      for (const f of files) {
        const text = await f.text();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new LooksError(NOT_A_LOOKS_FILE);
        }
        for (const look of parseLooksFile(json)) {
          imported.push({ ...look, name: uniqueName(look.name, [...looks, ...imported]) });
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
      notify.error('Could not export looks', errorMessage(e));
    }
  };

  render();
  return { el };
}
