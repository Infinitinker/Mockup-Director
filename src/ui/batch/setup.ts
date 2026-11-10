/**
 * The batch dialog's setup phase: the mode switch, the files or views to export and the output line, and the
 * Close and Start buttons.
 */
import type { ExportSettings } from '../../core/types/export';
import { IMAGE_ACCEPT } from '../../core/images';
import { getModel } from '../../models/registry';
import { VIEW_PRESETS } from '../../scene/views';
import { IMAGE_FORMAT_LABEL, supportsWebpEncoding } from '../../export/formats';
import type { BatchMode } from '../../export/batch/items';
import { PROJECT_EXT } from '../../project/format';
import { pickFiles } from '../../platform/files';
import type { AppContext } from '../context';
import { h, nextId, type Child } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { ICONS } from '../icons';
import { textButton } from '../controls/buttons';
import { segmentedControl } from '../controls/segmented';
import { selectControl } from '../controls/select';
import { notify } from '../toast';
import { addUnique, defaultSlot, isArtworkFile, isProjectFile, selection, storeMode } from './selection';

/** The mode and the slot that varies, which the setup phase and the dialog both change. */
export interface SetupChoice {
  mode: BatchMode;
  slotId: string;
}

/** What the setup phase needs from the dialog. */
export interface SetupHost {
  ctx: Pick<AppContext, 'store'>;
  content: HTMLElement;
  actions: HTMLElement;
  choice: SetupChoice;
  /** Render the dialog's current phase again. */
  render(): void;
  close(): void;
  start(): void;
}

const MODE_HINT: Record<BatchMode, string> = {
  artwork:
    'Every image file goes into the chosen slot of the current model and becomes a mockup of its own. The other slots, the model settings and the scene stay as they are.',
  views: 'Exports one image of the current project for each view you choose.',
  projects: 'Every project file (.mdproj) is rendered with its own model, artwork and scene.',
};

/** "1600 × 1600 px · PNG · transparent background" – mirrors the Export panel summary. */
function settingsSummary(e: ExportSettings): string {
  const format = e.format === 'webp' && !supportsWebpEncoding() ? 'png' : e.format;
  const fmt = IMAGE_FORMAT_LABEL[format];
  const transparent = e.background === 'transparent' && format !== 'jpeg';
  const size = e.sizing === 'trim' ? `up to ${e.width} × ${e.height} px (trimmed)` : `${e.width} × ${e.height} px`;
  return `${size} · ${fmt} · ${transparent ? 'transparent background' : 'with background'}`;
}

/** The setup phase of one dialog; `render` fills the dialog's content and actions with it. */
export function createSetup(d: SetupHost): { render(): void } {
  const { ctx, content, actions, choice } = d;

  const itemCount = (): number => {
    switch (choice.mode) {
      case 'artwork':
        return getModel(ctx.store.state.modelId).slots.length ? selection.artworkFiles.length : 0;
      case 'views':
        return selection.views.filter(Boolean).length;
      case 'projects':
        return selection.projectFiles.length;
    }
  };

  const fileList = (files: File[], onRemove: (i: number) => void): HTMLElement => {
    if (!files.length) return h('p', { class: 'ctl-note batch-empty', text: 'No files chosen yet.' });
    const list = h('ul', { class: 'batch-list' });
    files.forEach((f, i) => {
      list.appendChild(
        h(
          'li',
          { class: 'batch-list-item' },
          h('span', { class: 'batch-list-name', text: f.name, title: f.name }),
          h('button', {
            class: 'btn btn-ghost btn-small btn-icon-only',
            html: ICONS.close,
            title: 'Remove from list',
            label: `Remove from list: ${f.name}`,
            attrs: { type: 'button' },
            on: { click: () => onRemove(i) },
          }),
        ),
      );
    });
    return list;
  };

  const pickInto = async (which: 'artwork' | 'projects') => {
    try {
      const files =
        which === 'artwork'
          ? (await pickFiles(IMAGE_ACCEPT, true)).filter(isArtworkFile)
          : (await pickFiles(`.${PROJECT_EXT}`, true)).filter(isProjectFile);
      if (!files.length) return;
      if (which === 'artwork') selection.artworkFiles = addUnique(selection.artworkFiles, files);
      else selection.projectFiles = addUnique(selection.projectFiles, files);
      d.render();
    } catch (e) {
      logShownError('Could not pick the file', e);
      notify.error('Could not pick the file', errorMessage(e));
    }
  };

  const renderArtworkMode = (): Child[] => {
    const s = ctx.store.state;
    const model = getModel(s.modelId);
    const out: Child[] = [h('p', { class: 'batch-model', text: `Model: ${model.name}` })];
    if (!model.slots.length) {
      out.push(h('p', { class: 'ctl-note warn-note', text: 'This model has no artwork slots.' }));
      return out;
    }
    if (!model.slots.some((x) => x.id === choice.slotId)) choice.slotId = defaultSlot(model.id);
    const slotCtl = selectControl({
      label: 'Slot to vary',
      options: model.slots.map((x) => ({ value: x.id, label: x.label })),
      get: () => choice.slotId,
      set: (v) => {
        choice.slotId = v;
        selection.slots.set(model.id, v);
      },
    });
    out.push(
      slotCtl.el,
      h('p', {
        class: 'ctl-note',
        text: 'When the model has a slot for the whole cover or box (Cover wrap, Box net) with artwork, it may take precedence over the separate faces: then choose that slot.',
      }),
      h(
        'div',
        { class: 'batch-pick' },
        h(
          'button',
          { class: 'btn', attrs: { type: 'button' }, on: { click: () => void pickInto('artwork') } },
          h('span', { class: 'btn-icon', html: ICONS.image }),
          h('span', { class: 'btn-text', text: 'Choose artwork…' }),
        ),
        selection.artworkFiles.length
          ? textButton('Clear list', 'btn-ghost', () => {
              selection.artworkFiles = [];
              d.render();
            })
          : null,
      ),
      h('p', { class: 'ctl-note', text: 'You can also drop files onto this window.' }),
      selection.artworkFiles.length
        ? h('div', { class: 'batch-count', text: `Files chosen: ${selection.artworkFiles.length}` })
        : null,
      fileList(selection.artworkFiles, (i) => {
        selection.artworkFiles = selection.artworkFiles.filter((_, j) => j !== i);
        d.render();
      }),
    );
    return out;
  };

  const renderViewsMode = (): Child[] => {
    const list = h('div', { class: 'batch-views', attrs: { role: 'group', 'aria-label': 'Many views' } });
    const labels: string[] = ['Current view', ...VIEW_PRESETS.map((v) => v.label)];
    labels.forEach((label, i) => {
      const id = nextId('batch-view');
      const input = h('input', { attrs: { id, type: 'checkbox', checked: selection.views[i] } });
      input.addEventListener('change', () => {
        selection.views[i] = input.checked;
        syncSetup();
      });
      list.appendChild(h('label', { class: 'check-row', attrs: { for: id } }, input, h('span', { text: label })));
    });
    return [list];
  };

  const renderProjectsMode = (): Child[] => {
    const id = nextId('batch-own');
    const own = h('input', { attrs: { id, type: 'checkbox', checked: selection.ownExport } });
    own.addEventListener('change', () => {
      selection.ownExport = own.checked;
      syncSetup();
    });
    return [
      h(
        'div',
        { class: 'batch-pick' },
        h(
          'button',
          { class: 'btn', attrs: { type: 'button' }, on: { click: () => void pickInto('projects') } },
          h('span', { class: 'btn-icon', html: ICONS.open }),
          h('span', { class: 'btn-text', text: 'Choose projects…' }),
        ),
        selection.projectFiles.length
          ? textButton('Clear list', 'btn-ghost', () => {
              selection.projectFiles = [];
              d.render();
            })
          : null,
      ),
      h('p', { class: 'ctl-note', text: 'You can also drop files onto this window.' }),
      selection.projectFiles.length
        ? h('div', { class: 'batch-count', text: `Files chosen: ${selection.projectFiles.length}` })
        : null,
      fileList(selection.projectFiles, (i) => {
        selection.projectFiles = selection.projectFiles.filter((_, j) => j !== i);
        d.render();
      }),
      h(
        'label',
        { class: 'check-row batch-own', attrs: { for: id } },
        own,
        h('span', { text: 'Use each project’s export settings' }),
      ),
    ];
  };

  const outputSummary = h('p', { class: 'batch-output-text' });
  let startBtn: HTMLButtonElement | null = null;

  /** Refresh the parts of the setup phase that depend on the selection. */
  const syncSetup = () => {
    const n = itemCount();
    const settings =
      choice.mode === 'projects' && selection.ownExport
        ? 'each project’s export settings'
        : settingsSummary(ctx.store.state.export);
    outputSummary.textContent = `Images: ${n} · ${settings} → one ZIP file`;
    if (startBtn) startBtn.disabled = n === 0;
  };

  const render = () => {
    const modeCtl = segmentedControl<BatchMode>({
      ariaLabel: 'Batch export mode',
      compact: true,
      options: [
        {
          value: 'artwork',
          label: 'Many images',
          title: MODE_HINT.artwork,
        },
        {
          value: 'views',
          label: 'Many views',
          title: MODE_HINT.views,
        },
        {
          value: 'projects',
          label: 'Many projects',
          title: MODE_HINT.projects,
        },
      ],
      get: () => choice.mode,
      set: (v) => {
        choice.mode = v;
        storeMode(v);
        d.render();
        // render() replaced the focused segment – keep keyboard focus inside the dialog.
        content.querySelector<HTMLElement>('.batch-mode [aria-checked="true"]')?.focus();
      },
    });
    modeCtl.el.classList.add('batch-mode');
    const body =
      choice.mode === 'artwork'
        ? renderArtworkMode()
        : choice.mode === 'views'
          ? renderViewsMode()
          : renderProjectsMode();
    content.replaceChildren(
      modeCtl.el,
      h('p', { class: 'dialog-message', text: MODE_HINT[choice.mode] }),
      h('div', { class: 'batch-body' }, ...body),
      h('div', { class: 'batch-output' }, h('div', { class: 'ctl-label', text: 'Output' }), outputSummary),
    );
    startBtn = textButton('Start', 'btn-primary', () => d.start());
    actions.replaceChildren(
      textButton('Close', '', () => d.close()),
      startBtn,
    );
    syncSetup();
  };

  return { render };
}
