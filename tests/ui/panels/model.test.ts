/** Tests how the Model tab puts the parameters into sections and picks the control of a select parameter. */
import { describe, expect, it } from 'vitest';
import type { ParamDef } from '../../../src/core/types/model';
import { fitsSegmented, groupParams } from '../../../src/ui/panels/model';

const param = (id: string, group?: string): ParamDef => ({
  id,
  label: id,
  type: 'boolean',
  default: false,
  ...(group ? { group } : {}),
});

const options = (...labels: string[]) => labels.map((label) => ({ value: label, label }));

describe('groupParams', () => {
  it('keeps the order in which each group first appears', () => {
    const groups = groupParams([param('a', 'Size'), param('b', 'Material'), param('c', 'Size')]);
    expect([...groups.keys()]).toEqual(['Size', 'Material']);
    expect(groups.get('Size')).toEqual({ title: 'Size', defs: [param('a', 'Size'), param('c', 'Size')] });
    expect(groups.get('Material')?.defs.map((d) => d.id)).toEqual(['b']);
  });

  it('puts the parameters without a group under __general, titled General', () => {
    // The key is part of the stored collapsed-section keys (model.<id>.<key>): it must never change.
    const groups = groupParams([param('a'), param('b', 'Size'), param('c')]);
    expect([...groups.keys()]).toEqual(['__general', 'Size']);
    expect(groups.get('__general')).toEqual({ title: 'General', defs: [param('a'), param('c')] });
  });

  it('makes no sections without parameters', () => {
    expect(groupParams([]).size).toBe(0);
  });
});

describe('fitsSegmented', () => {
  it('takes up to three options with up to 26 characters in all', () => {
    expect(fitsSegmented(options('Matte', 'Glossy'))).toBe(true);
    expect(fitsSegmented(options('123456789', '123456789', '12345678'))).toBe(true);
  });

  it('leaves longer lists to a menu', () => {
    expect(fitsSegmented(options('123456789', '123456789', '123456789'))).toBe(false);
    expect(fitsSegmented(options('A', 'B', 'C', 'D'))).toBe(false);
  });
});
