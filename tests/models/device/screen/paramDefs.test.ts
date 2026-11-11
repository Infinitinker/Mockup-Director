/**
 * Tests the parameters the screenshot panel and the browser window share, in
 * src/models/device/screen/paramDefs.ts, through their definitions: the ids and groups, the width
 * and corner radius defaults each model passes in, and the finish options.
 */
import { describe, expect, it } from 'vitest';
import type { ModelDefinition, ParamDef } from '../../../../src/core/types/model';
import { browserWindowModel } from '../../../../src/models/device/screen/browser';
import { screenshotModel } from '../../../../src/models/device/screen/screenshot';

function param(model: ModelDefinition, id: string): ParamDef {
  const found = model.params.find((p) => p.id === id);
  if (!found) throw new Error(`No parameter ${id}.`);
  return found;
}

const SHARED: [string, string][] = [
  ['width', 'Dimensions'],
  ['thickness', 'Dimensions'],
  ['cornerRadius', 'Dimensions'],
  ['curvature', 'Shape & placement'],
  ['tilt', 'Shape & placement'],
  ['finish', 'Material'],
  ['glow', 'Material'],
  ['bodyFinish', 'Material'],
];

describe('screen parameters', () => {
  it('gives both models the shared parameters in their groups', () => {
    for (const model of [screenshotModel, browserWindowModel]) {
      for (const [id, group] of SHARED) expect(param(model, id).group, `${model.id} ${id}`).toBe(group);
    }
  });

  it('takes the width and corner radius defaults from each model', () => {
    expect(param(screenshotModel, 'width')).toMatchObject({ min: 40, max: 2000, default: 300, unit: 'mm' });
    expect(param(browserWindowModel, 'width').default).toBe(320);
    expect(param(screenshotModel, 'cornerRadius').default).toBe(6);
    expect(param(browserWindowModel, 'cornerRadius').default).toBe(4);
  });

  it('offers the lit screens and the prints as finishes, a lit glossy screen by default', () => {
    const finish = param(screenshotModel, 'finish');
    expect(finish.type === 'select' ? finish.options.map((o) => o.value) : null).toEqual([
      'screen',
      'screenMatte',
      'printMatte',
      'printGloss',
    ]);
    expect(finish.default).toBe('screen');
    expect(param(browserWindowModel, 'bodyFinish').default).toBe('plastic');
  });
});
