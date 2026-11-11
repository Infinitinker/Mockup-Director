/**
 * Tests the screen slot of the phone and the tablet in src/models/device/handheld/slot.ts, through
 * their definitions: the aspect and the recommended size at the defaults, and the print template
 * with the punch-hole camera in either orientation.
 */
import { describe, expect, it } from 'vitest';
import type { ImageSlotDef, ParamValues, PrintTemplate } from '../../../../src/core/types/model';
import { phoneModel } from '../../../../src/models/device/handheld/phone';
import { tabletModel } from '../../../../src/models/device/handheld/tablet';

function template(slot: ImageSlotDef, params: ParamValues): PrintTemplate {
  if (typeof slot.template !== 'function') throw new Error('The screen slot has no template function.');
  return slot.template(params);
}

describe('makeSlot', () => {
  it('gives the phone a portrait screen slot with the recommended size in pixels', () => {
    const slot = phoneModel.slots[0];
    expect(slot.id).toBe('screen');
    expect(slot.aspect).toBeCloseTo(67.9 / 143.4, 10);
    expect(slot.hint).toContain(
      'Recommended size: 1230 × 2597 px portrait (screen 67.9 × 143.4 mm); for landscape, swap the sizes.',
    );
    expect(slot.hint).toContain('1179 × 2556 px');
  });

  it('gives the tablet a landscape screen slot', () => {
    const slot = tabletModel.slots[0];
    expect(slot.aspect).toBeCloseTo(231.6 / 163.5, 10);
    expect(slot.hint).toContain('px landscape (screen 231.6 × 163.5 mm); for portrait, swap the sizes.');
    expect(slot.hint).toContain('2388 × 1668 px');
  });

  it('marks the punch-hole camera in the template, in either orientation', () => {
    const portrait = template(phoneModel.slots[0], {});
    expect(portrait.widthMm).toBeCloseTo(67.9, 10);
    expect(portrait.heightMm).toBeCloseTo(143.4, 10);
    expect(portrait.bleedMm).toBeUndefined();
    const [screen, camera] = portrait.regions ?? [];
    expect(screen).toMatchObject({ xMm: 0, yMm: 0, label: 'Screen' });
    expect(camera.label).toBe('Camera');
    expect(camera.wMm).toBeCloseTo(4.2, 10);
    expect(camera.xMm + camera.wMm / 2).toBeCloseTo(67.9 / 2, 10);
    expect(camera.yMm + camera.hMm / 2).toBeCloseTo(6 - 1.8, 10);

    const landscape = template(phoneModel.slots[0], { orientation: 'landscape' });
    expect(landscape.widthMm).toBeCloseTo(143.4, 10);
    const [, turned] = landscape.regions ?? [];
    expect(turned.xMm + turned.wMm / 2).toBeCloseTo(6 - 1.8, 10);
    expect(turned.yMm + turned.hMm / 2).toBeCloseTo(67.9 / 2, 10);
  });

  it('marks no camera when it sits in the bezel or is left out', () => {
    expect(template(tabletModel.slots[0], {}).regions).toHaveLength(1);
    expect(template(phoneModel.slots[0], { frontCamera: 'none' }).regions).toHaveLength(1);
  });
});
