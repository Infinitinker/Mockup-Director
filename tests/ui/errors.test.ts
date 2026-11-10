/**
 * What the interface says about an error (`errorMessage`): a UserError's own message, a general
 * message with the raw text as detail for anything else.
 */
import { describe, expect, it } from 'vitest';
import { UserError } from '../../src/core/errors';
import { LooksError } from '../../src/project/looks';
import { errorMessage } from '../../src/ui/errors';

const unexpected = (detail: string): string =>
  `Something unexpected went wrong: ${detail}. If it keeps happening, report it at github.com/Infinitinker/Mockup-Director/issues.`;

describe('errorMessage', () => {
  it('shows the message of a UserError and its subclasses as it is', () => {
    const message = 'Not enough memory to load an image this large. Choose a smaller image.';
    expect(errorMessage(new UserError(message))).toBe(message);
    expect(errorMessage(new LooksError(message, true))).toBe(message);
  });

  it('names a UserError', () => {
    expect(new UserError('x').name).toBe('UserError');
  });

  it('wraps the message of any other error, without its final period', () => {
    expect(errorMessage(new Error('Image element failed to load'))).toBe(unexpected('Image element failed to load'));
    expect(errorMessage(new TypeError('x is not a function.'))).toBe(unexpected('x is not a function'));
  });

  it('wraps a DOMException, by its name when it has no message', () => {
    expect(errorMessage(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))).toBe(
      unexpected('The quota has been exceeded'),
    );
    expect(errorMessage(new DOMException('', 'AbortError'))).toBe(unexpected('AbortError'));
  });

  it('wraps strings and other values', () => {
    expect(errorMessage('session save failed')).toBe(unexpected('session save failed'));
    expect(errorMessage({ code: 7 })).toBe(unexpected('{"code":7}'));
    expect(errorMessage(42)).toBe(unexpected('42'));
    expect(errorMessage(undefined)).toBe(unexpected('undefined'));
  });

  it('leaves out an empty detail', () => {
    expect(errorMessage(new Error(''))).toBe(unexpected('Error'));
    expect(errorMessage('  ')).toBe(
      'Something unexpected went wrong. If it keeps happening, report it at github.com/Infinitinker/Mockup-Director/issues.',
    );
  });

  it('falls back to String() for a value JSON cannot write', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(errorMessage(cyclic)).toBe(unexpected('[object Object]'));
  });
});
