/**
 * "Model" tab: controls generated from model.params, grouped by param.group.
 */
import type { ParamDef, ParamValue } from '../../core/types';
import { defaultParams } from '../../core/defaults';
import { getModel } from '../../models/registry';
import type { AppContext } from '../context';
import { h } from '../dom';
import { ICONS } from '../icons';
import {
  colorControl,
  numberControl,
  section,
  segmentedControl,
  selectControl,
  switchControl,
  type Control,
} from '../controls';
import { completeParams, snapToStep } from '../../models/params';

const UNIT_LABEL: Record<string, string> = { mm: 'mm', deg: '°', '%': '%', '': '' };

export function createModelPanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-model' });
  let controls: Control[] = [];

  const current = () => {
    const s = ctx.store.state;
    const model = getModel(s.modelId);
    return { model, params: completeParams(model, s.params[model.id]) };
  };

  const setParam = (id: string, v: ParamValue) => {
    const { model } = current();
    ctx.store.update(['params'], (s) => {
      const p = { ...defaultParams(model), ...(s.params[model.id] ?? {}) };
      p[id] = v;
      s.params[model.id] = p;
    });
  };

  const controlFor = (def: ParamDef): Control => {
    switch (def.type) {
      case 'number':
        return numberControl({
          label: def.label,
          min: def.min,
          max: def.max,
          step: def.step,
          unit: def.unit ? UNIT_LABEL[def.unit] : undefined,
          get: () => current().params[def.id] as number,
          set: (v) => setParam(def.id, snapToStep(v, def.step, def.min, def.max)),
        });
      case 'boolean':
        return switchControl({
          label: def.label,
          get: () => current().params[def.id] as boolean,
          set: (v) => setParam(def.id, v),
        });
      case 'select': {
        const opts = def.options;
        // Short option lists read best as a segmented control; long ones as a menu.
        const totalLen = opts.reduce((n, o) => n + o.label.length, 0);
        if (opts.length <= 3 && totalLen <= 26) {
          return segmentedControl<string>({
            label: def.label,
            options: opts,
            get: () => current().params[def.id] as string,
            set: (v) => setParam(def.id, v),
          });
        }
        return selectControl({
          label: def.label,
          options: opts,
          get: () => current().params[def.id] as string,
          set: (v) => setParam(def.id, v),
        });
      }
      case 'color':
        return colorControl({
          label: def.label,
          get: () => current().params[def.id] as string,
          set: (v) => setParam(def.id, v),
        });
    }
  };

  const render = () => {
    el.replaceChildren();
    controls = [];
    const { model } = current();
    el.appendChild(
      h(
        'div',
        { class: 'panel-header' },
        h(
          'div',
          {},
          h('div', { class: 'panel-title', text: model.name }),
          model.description ? h('div', { class: 'panel-sub', text: model.description }) : null,
        ),
      ),
    );
    if (!model.params.length) {
      el.appendChild(h('p', { class: 'empty-state', text: 'This model has no settings.' }));
      return;
    }
    // Group params, keeping the order of first appearance.
    const groups = new Map<string, { title: string; defs: ParamDef[] }>();
    for (const def of model.params) {
      const key = def.group ?? '__general';
      const title = def.group ?? 'General';
      let group = groups.get(key);
      if (!group) {
        group = { title, defs: [] };
        groups.set(key, group);
      }
      group.defs.push(def);
    }
    for (const [key, g] of groups) {
      const ctls = g.defs.map(controlFor);
      controls.push(...ctls);
      el.appendChild(
        section(
          `model.${model.id}.${key}`,
          g.title,
          ctls.map((c) => c.el),
        ),
      );
    }
    el.appendChild(
      h(
        'div',
        { class: 'panel-footer' },
        h(
          'button',
          {
            class: 'btn',
            attrs: { type: 'button' },
            on: {
              click: () =>
                ctx.store.update(['params'], (s) => {
                  s.params[model.id] = defaultParams(model);
                }),
            },
          },
          h('span', { class: 'btn-icon', html: ICONS.reset }),
          h('span', { class: 'btn-text', text: 'Restore defaults' }),
        ),
      ),
    );
  };

  ctx.store.subscribe((e) => {
    if (e.kinds.has('model')) render();
    else if (e.kinds.has('params'))
      controls.forEach((c) => {
        c.sync();
      });
  });
  render();
  return { el };
}
