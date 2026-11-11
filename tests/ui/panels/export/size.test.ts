/** Tests the size the Export tab's width and height fields set when the user types a value, with and without the lock. */
import { describe, expect, it } from 'vitest';
import { typedSize } from '../../../../src/ui/panels/export/size';

const current = { width: 1600, height: 800 };

describe('typedSize', () => {
  it('keeps the other side without the lock', () => {
    expect(typedSize('width', 1000, current, false, 16, 4000)).toEqual([1000, 800]);
    expect(typedSize('height', 1000, current, false, 16, 4000)).toEqual([1600, 1000]);
  });

  it('scales the other side along with the lock', () => {
    expect(typedSize('width', 1000, current, true, 16, 4000)).toEqual([1000, 500]);
    expect(typedSize('height', 1000, current, true, 16, 4000)).toEqual([2000, 1000]);
  });

  it('rounds the value and clamps it to the limits', () => {
    expect(typedSize('width', 999.6, current, false, 16, 4000)).toEqual([1000, 800]);
    expect(typedSize('width', 3, current, false, 16, 4000)).toEqual([16, 800]);
    expect(typedSize('height', 9000, current, false, 16, 4000)).toEqual([1600, 4000]);
  });

  it('scales both sides down when the other side would pass the limit', () => {
    expect(typedSize('height', 3000, current, true, 16, 4000)).toEqual([4000, 2000]);
    expect(typedSize('width', 3000, { width: 800, height: 1600 }, true, 16, 4000)).toEqual([2000, 4000]);
  });

  it('keeps the other side when the current one is 0', () => {
    expect(typedSize('width', 1000, { width: 0, height: 800 }, true, 16, 4000)).toEqual([1000, 800]);
    expect(typedSize('height', 1000, { width: 1600, height: 0 }, true, 16, 4000)).toEqual([1600, 1000]);
  });
});
