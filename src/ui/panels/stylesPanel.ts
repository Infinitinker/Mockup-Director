/**
 * "Style" tab: named looks (scene presets) – built-in and user-defined, import/export as JSON.
 */
import type { ScenePreset } from '../../core/types';
import type { AppContext } from '../context';
import { lt, t } from '../i18n';
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
  const bg = b.mode === 'gradient' ? `linear-gradient(180deg, ${b.color}, ${b.color2})` : b.mode === 'color' ? b.color : '';
  return h('span', { class: `preset-swatch${b.mode === 'transparent' ? ' checkerboard' : ''}`, style: bg ? `background:${bg}` : undefined, attrs: { 'aria-hidden': 'true' } });
}

export function createStylesPanel(ctx: AppContext): { el: HTMLElement; render(): void } {
  const el = h('div', { class: 'panel panel-styles' });
  let presets = loadUserPresets();

  const persist = () => saveUserPresets(presets);

  const apply = (p: ScenePreset['scene'], name: string) => {
    const kinds: ('scene' | 'camera')[] = p.camera ? ['scene', 'camera'] : ['scene'];
    ctx.store.update(kinds, (s) => {
      s.scene = applyPresetToScene(s.scene, p);
    });
    notify.success(t('styleApplied', { name }));
  };

  const row = (name: string, scene: ScenePreset['scene'], index: number | null) => {
    const applyBtn = h(
      'button',
      {
        class: 'preset-apply',
        title: t('applyStyle'),
        attrs: { type: 'button' },
        on: { click: () => apply(scene, name) },
      },
      swatch(scene),
      h('span', { class: 'preset-name', text: name }),
      scene.camera ? h('span', { class: 'preset-tag', text: t('withCamera') }) : null,
    );
    const actions = h('span', { class: 'preset-actions' });
    if (index !== null) {
      actions.append(
        iconButton(ICONS.pencil, t('rename'), async () => {
          const v = await promptDialog({ title: t('renameStyle'), label: t('styleName'), value: presets[index].name, okLabel: t('rename') });
          if (!v) return;
          presets[index] = { ...presets[index], name: uniqueName(v, presets, index) };
          persist();
          render();
        }, { cls: 'btn-icon-only btn-ghost' }),
        iconButton(ICONS.trash, t('delete'), async () => {
          const ok = await confirmDialog({ title: t('deleteStyleTitle', { name: presets[index].name }), message: t('deleteStyleMsg'), okLabel: t('delete'), danger: true });
          if (!ok) return;
          presets.splice(index, 1);
          persist();
          render();
        }, { cls: 'btn-icon-only btn-ghost' }),
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
    const nameInput = h('input', { class: 'text-input', attrs: { id: nameId, type: 'text', maxlength: 80, placeholder: t('styleNamePlaceholder'), autocomplete: 'off' } });
    const camInput = h('input', { attrs: { id: camId, type: 'checkbox' } });
    const save = () => {
      const raw = nameInput.value.trim() || t('styleDefaultName');
      const name = uniqueName(raw, presets);
      presets.push(presetFromScene(name, ctx.store.state.scene, camInput.checked));
      persist();
      notify.success(t('styleSaved', { name }));
      render();
    };
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
    });
    const saveSection = section('styles.save', t('saveCurrentStyle'), [
      h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', text: t('styleName'), attrs: { for: nameId } }), nameInput),
      h('label', { class: 'check-row', attrs: { for: camId } }, camInput, h('span', { text: t('includeCamera') })),
      h(
        'div',
        { class: 'ctl-actions' },
        h('button', { class: 'btn btn-primary btn-small', attrs: { type: 'button' }, on: { click: save } }, h('span', { class: 'btn-icon', html: ICONS.plus }), h('span', { class: 'btn-text', text: t('saveStyle') })),
      ),
    ]);

    // User presets.
    const userList = h('ul', { class: 'preset-list', attrs: { role: 'list' } });
    presets.forEach((p, i) => userList.appendChild(row(p.name, p.scene, i)));
    const userSection = section('styles.user', t('myStyles'), [
      presets.length ? userList : h('p', { class: 'empty-state small', text: t('noUserStyles') }),
      h(
        'div',
        { class: 'ctl-actions' },
        iconButton(ICONS.upload, t('importStyles'), () => void importPresets(), { cls: 'btn-small', text: t('import') }),
        iconButton(ICONS.download, t('exportStyles'), () => void exportPresets(), { cls: 'btn-small', text: t('exportJson') }),
      ),
    ]);

    // Built-ins.
    const builtinList = h('ul', { class: 'preset-list', attrs: { role: 'list' } });
    BUILTIN_PRESETS.forEach((p) => builtinList.appendChild(row(lt(p.name), p.scene, null)));
    const builtinSection = section('styles.builtin', t('builtinStyles'), [builtinList]);

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
        notify.warning(t('noStylesInFile'));
        return;
      }
      persist();
      render();
      notify.success(t('stylesImported', { n: added }));
    } catch (e) {
      notify.error(t('errImportStyles'), errorMessage(e));
    }
  };

  const exportPresets = async () => {
    try {
      if (!presets.length) {
        notify.info(t('noUserStyles'));
        return;
      }
      const blob = new Blob([JSON.stringify({ app: 'mockup-director', kind: 'presets', presets }, null, 2)], { type: 'application/json' });
      const ok = await saveBlob(blob, 'mockup-director-style.json', [{ name: 'JSON', extensions: ['json'] }]);
      if (ok) notify.success(t('saved'), 'mockup-director-style.json');
    } catch (e) {
      notify.error(t('errExportStyles'), errorMessage(e));
    }
  };

  ctx.store.subscribe((e) => {
    if (e.kinds.has('lang')) render();
  });
  render();
  return { el, render };
}
