/**
 * Tests the parameter pieces every print model shares, in src/models/print/common.ts: the paper
 * thickness and the material color.
 */
import { describe, expect, it } from 'vitest';
import { colorParam, thicknessParam } from '../../../src/models/print/common';

describe('the shared print parameters', () => {
  it('makes a thickness in millimeters and a color, both in the Material group', () => {
    expect(thicknessParam(0.15, 0.06, 0.8, 0.01)).toEqual({
      id: 'thickness',
      type: 'number',
      label: 'Paper thickness',
      group: 'Material',
      min: 0.06,
      max: 0.8,
      step: 0.01,
      default: 0.15,
      unit: 'mm',
    });
    expect(thicknessParam(0.5, 0.25, 0.9, 0.05, 'Card thickness').label).toBe('Card thickness');
    expect(colorParam('coreColor', 'Core color', '#ffffff')).toEqual({
      id: 'coreColor',
      type: 'color',
      label: 'Core color',
      group: 'Material',
      default: '#ffffff',
    });
  });
});
