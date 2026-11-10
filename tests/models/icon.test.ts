/** Tests the gallery icon frame in src/models/icon.ts. */
import { describe, expect, it } from 'vitest';
import { icon } from '../../src/models/icon';

describe('icon', () => {
  it('wraps the body in a 64 × 64 line-art frame, 2.75 wide by default', () => {
    expect(icon('<circle cx="32" cy="32" r="3"/>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" ' +
        'stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="3"/></svg>',
    );
  });

  it('takes another stroke width', () => {
    expect(icon('', 2.5)).toContain(' stroke-width="2.5" ');
    expect(icon('', 2.5)).not.toContain('2.75');
  });
});
