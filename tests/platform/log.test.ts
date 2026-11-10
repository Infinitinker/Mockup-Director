/** Tests of src/platform/log.ts: how errors are described, how long entries are cut, and where entries go outside the desktop app. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../src/core/errors';
import { describeError, formatEntry, log, MAX_ENTRY_LENGTH } from '../../src/platform/log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('describeError', () => {
  it('gives the name and message, then the frames of the stack', () => {
    const text = describeError(new UserError('The file is damaged.'));
    const [head, ...frames] = text.split('\n');
    expect(head).toBe('UserError: The file is damaged.');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((line) => /^\s+at /.test(line))).toBe(true);
  });

  it('describes the causes', () => {
    const error = new UserError('Cannot open the project.', { cause: new RangeError('Too large') });
    const lines = describeError(error).split('\n');
    expect(lines).toContain('Caused by: RangeError: Too large');
  });

  it('stops after a few causes, also when they go round in a circle', () => {
    const error = new Error('Again');
    error.cause = error;
    expect(
      describeError(error)
        .split('\n')
        .filter((line) => line.startsWith('Caused by:')),
    ).toHaveLength(5);
  });

  it('leaves out what a parser quotes from the text it parsed', () => {
    let parseError: unknown;
    try {
      JSON.parse('{"artwork": secret');
    } catch (e) {
      parseError = e;
    }
    const text = describeError(new UserError('The file is damaged.', { cause: parseError }));
    expect(text).toContain('Caused by: SyntaxError');
    expect(text).not.toContain('secret');
  });

  it('keeps a stack that lists only frames, as WebKit writes it', () => {
    const error = new Error('Failed');
    error.stack = 'save@app.js:10:5\nrun@app.js:20:3';
    expect(describeError(error)).toBe('Error: Failed\nsave@app.js:10:5\nrun@app.js:20:3');
  });

  it('describes values that are not errors', () => {
    expect(describeError('plain text')).toBe('plain text');
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
    expect(describeError({ kind: 'io', path: 'a.png' })).toBe('{"kind":"io","path":"a.png"}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe('[object Object]');
  });
});

describe('formatEntry', () => {
  it('puts the error after the message', () => {
    expect(formatEntry('Export failed', 'disk full')).toBe('Export failed\ndisk full');
    expect(formatEntry('Started')).toBe('Started');
  });

  it('cuts long entries, saying how much was left out', () => {
    const entry = formatEntry('x'.repeat(MAX_ENTRY_LENGTH + 10));
    expect(entry).toBe(`${'x'.repeat(MAX_ENTRY_LENGTH)} [10 more characters left out]`);
  });

  it('does not cut a character outside the BMP in half', () => {
    const entry = formatEntry(`${'a'.repeat(MAX_ENTRY_LENGTH - 1)}😀${'b'.repeat(10)}`);
    expect(entry).toBe(`${'a'.repeat(MAX_ENTRY_LENGTH - 1)} [12 more characters left out]`);
    expect(() => encodeURIComponent(entry)).not.toThrow();
  });
});

describe('log', () => {
  it('writes to the console outside the desktop app', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    log.error('Export failed', 'disk full');
    log.warn('Slow save');
    log.info('Started');
    expect(error).toHaveBeenCalledWith('Export failed\ndisk full');
    expect(warn).toHaveBeenCalledWith('Slow save');
    expect(info).toHaveBeenCalledWith('Started');
  });
});
