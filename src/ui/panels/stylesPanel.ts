/**
 * "Looks" tab: named looks – built-in and the user's own, imported and exported as JSON.
 */
import type { ScenePreset } from '../../core/types';
import type { AppContext } from '../context';
import { errorMessage, h, nextId } from '../dom';
import { ICONS } from '../icons';
import { iconButton, section } from '../controls';
import { confirmDialog, promptDialog } from '../dialog';
import { notify } from '../toast';
import { saveBlob, pickFiles } from '../../platform/files';
import {
  BUILTIN_PRESETS,
  applyPresetToScene,
  loadUserPresets,
  parsePresetJson,
  presetFromScene,
  saveUserPresets,
  uniqueName,
} from '../presets';

function swatch(p: ScenePreset['scene']): HTMLElement {
  const b = p.background;
  const bg =
    b.mode === 'gradient' ? `linear-gradient(180deg, ${b.color}, ${b.color2})` : b.mode === 'color' ? b.color : '';
  return h('span', {
    class: `preset-swatch${b.mode === 'transparent' ? ' checkerboard' : ''}`,
    style: bg ? `background:${bg}` : undefined,
    attrs: { 'aria-hidden': 'true' },
  });
}

export function createStylesPanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-styles' });
  let presets = loadUserPresets();

  const persist = () => saveUserPresets(presets);

  const apply = (p: ScenePreset['scene'], name: string) => {
    const kinds: ('scene' | 'camera')[] = p.camera ? ['scene', 'camera'] : ['scene'];
    ctx.store.update(kinds, (s) => {
      s.scene = applyPresetToScene(s.scene, p);
    });
    notify.success(`Applied look “${name}”`);
  };

  const row = (name: string, scene: ScenePreset['scene'], index: number | null) => {
    const applyBtn = h(
      'button',
      {
        class: 'preset-apply',
        title: 'Apply look',
        attrs: { type: 'button' },
        on: { click: () => apply(scene, name) },
      },
      swatch(scene),
      h('span', { class: 'preset-name', text: name }),
      scene.camera ? h('span', { class: 'preset-tag', text: '+ camera' }) : null,
    );
    const actions = h('span', { class: 'preset-actions' });
    if (index !== null) {
      actions.append(
        iconButton(
          ICONS.pencil,
          'Rename',
          async () => {
            const v = await promptDialog({
              title: 'Rename look',
              label: 'Look name',
              value: presets[index].name,
              okLabel: 'Rename',
            });
            if (!v) return;
            presets[index] = { ...presets[index], name: uniqueName(v, presets, index) };
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
              title: `Delete look “${presets[index].name}”?`,
              message: 'This cannot be undone.',
              okLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            presets.splice(index, 1);
            persist();
            render();
          },
          { cls: 'btn-icon-only btn-ghost' },
        ),
      );
    }
    return h('li', { class: 'preset-row' }, applyBtn, actions);
  };

  const render = () => {
    el.replaceChildren();
    presets = loadUserPresets();

    // Save current look.
    const nameId = nextId('pn');
    const camId = nextId('pc');
    const nameInput = h('input', {
      class: 'text-input',
      attrs: {
        id: nameId,
        type: 'text',
        maxlength: 80,
        placeholder: 'e.g. Bright studio – client X',
        autocomplete: 'off',
      },
    });
    const camInput = h('input', { attrs: { id: camId, type: 'checkbox' } });
    const save = () => {
      const raw = nameInput.value.trim() || 'My look';
      const name = uniqueName(raw, presets);
      presets.push(presetFromScene(name, ctx.store.state.scene, camInput.checked));
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
    const saveSection = section('styles.save', 'Save current look', [
      h(
        'div',
        { class: 'ctl' },
        h('label', { class: 'ctl-label', text: 'Look name', attrs: { for: nameId } }),
        nameInput,
      ),
      h('label', { class: 'check-row', attrs: { for: camId } }, camInput, h('span', { text: 'Also save the camera' })),
      h(
        'div',
        { class: 'ctl-actions' },
        h(
          'button',
          { class: 'btn btn-primary btn-small', attrs: { type: 'button' }, on: { click: save } },
          h('span', { class: 'btn-icon', html: ICONS.plus }),
          h('span', { class: 'btn-text', text: 'Save look' }),
        ),
      ),
    ]);

    // User presets.
    const userList = h('ul', { class: 'preset-list', attrs: { role: 'list' } });
    presets.forEach((p, i) => {
      userList.appendChild(row(p.name, p.scene, i));
    });
    const userSection = section('styles.user', 'My looks', [
      presets.length ? userList : h('p', { class: 'empty-state small', text: 'You have no saved looks yet.' }),
      h(
        'div',
        { class: 'ctl-actions' },
        iconButton(ICONS.upload, 'Import looks from a JSON file', () => void importPresets(), {
          cls: 'btn-small',
          text: 'Import…',
        }),
        iconButton(ICONS.download, 'Export my looks to a JSON file', () => void exportPresets(), {
          cls: 'btn-small',
          text: 'Export…',
        }),
      ),
    ]);

    // Built-ins.
    const builtinList = h('ul', { class: 'preset-list', attrs: { role: 'list' } });
    BUILTIN_PRESETS.forEach((p) => {
      builtinList.appendChild(row(p.name, p.scene, null));
    });
    const builtinSection = section('styles.builtin', 'Built-in looks', [builtinList]);

    el.append(saveSection, userSection, builtinSection);
  };

  const importPresets = async () => {
    try {
      const files = await pickFiles('.json,application/json', true);
      if (!files.length) return;
      let added = 0;
      for (const f of files) {
        const list = parsePresetJson(JSON.parse(await f.text()) as unknown);
        for (const p of list) {
          presets.push({ ...p, name: uniqueName(p.name, presets) });
          added += 1;
        }
      }
      if (!added) {
        notify.warning('No looks found in the file.');
        return;
      }
      persist();
      render();
      notify.success(`Imported looks: ${added}`);
    } catch (e) {
      notify.error('Could not import looks', errorMessage(e));
    }
  };

  const exportPresets = async () => {
    try {
      if (!presets.length) {
        notify.info('You have no saved looks yet.');
        return;
      }
      const blob = new Blob([JSON.stringify({ app: 'mockup-director', kind: 'presets', presets }, null, 2)], {
        type: 'application/json',
      });
      const saved = await saveBlob(blob, 'mockup-director-style.json', [{ name: 'JSON', extensions: ['json'] }]);
      if (saved) notify.success('Saved', saved);
    } catch (e) {
      notify.error('Could not export looks', errorMessage(e));
    }
  };

  render();
  return { el };
}
