/**
 * Tests src/platform/commandErrors.ts: the message for each kind of shell error, which errors become
 * a `UserError`, and that anything else passes through unchanged.
 */
import { describe, expect, it } from 'vitest';
import { UserError } from '../../src/core/errors';
import {
  type CommandError,
  type CommandErrorKind,
  commandErrorMessage,
  fromCommandError,
  isCommandError,
} from '../../src/platform/commandErrors';

const USER_KINDS: CommandErrorKind[] = [
  'not-found',
  'permission-denied',
  'not-a-file',
  'too-large',
  'disk-full',
  'not-text',
  'io',
];

function error(kind: CommandErrorKind, path = '/home/ania/Projekty/Okładka.mdproj'): CommandError {
  return { kind, path, detail: 'os error 2' };
}

describe('commandErrorMessage', () => {
  it('names the file, not its folder, on Windows and elsewhere', () => {
    expect(commandErrorMessage(error('disk-full'), 'save')).toBe(
      '“Okładka.mdproj” could not be saved: the drive is full. Free some space or choose another drive.',
    );
    expect(commandErrorMessage(error('not-found', 'C:\\Users\\ania\\Box.mdproj'), 'open')).toBe(
      '“Box.mdproj” could not be opened: the file no longer exists, or it was moved. Open it from where it is now.',
    );
  });

  it('writes a message for every kind and action: what happened, then what to do', () => {
    for (const action of ['save', 'open'] as const) {
      for (const kind of USER_KINDS) {
        const message = commandErrorMessage(error(kind), action);
        expect(message, `${action} ${kind}`).toMatch(
          /^“Okładka\.mdproj” could not be (saved|opened)(: .+)?\. [A-Z].*\.$/,
        );
        expect(message).not.toContain('os error');
        expect(message).not.toMatch(/Please|"|'/);
      }
    }
  });

  it('tells the reasons apart', () => {
    for (const action of ['save', 'open'] as const) {
      const messages = new Set(USER_KINDS.map((kind) => commandErrorMessage(error(kind), action)));
      // Saving has no "not-text" message, opening none for "too-large" and "disk-full": they share the general one.
      expect(messages.size).toBe(action === 'save' ? 6 : 5);
    }
  });
});

describe('fromCommandError', () => {
  it('turns an error the user can act on into a UserError with the shell error as its cause', () => {
    const shell = error('permission-denied');
    const result = fromCommandError(shell, 'save');
    expect(result).toBeInstanceOf(UserError);
    expect((result as UserError).message).toBe(commandErrorMessage(shell, 'save'));
    expect((result as UserError).cause).toBe(shell);
  });

  it('turns a malformed call into a plain Error, as the bug it is', () => {
    const result = fromCommandError({ kind: 'invalid-request', path: '', detail: 'missing x-path header' }, 'save');
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(UserError);
    expect((result as Error).message).not.toContain('missing x-path header');
    expect((result as Error).cause).toMatchObject({ detail: 'missing x-path header' });
  });

  it('passes anything else through unchanged', () => {
    const failure = new Error('IPC is not available');
    expect(fromCommandError(failure, 'open')).toBe(failure);
    expect(fromCommandError('save_file not allowed', 'save')).toBe('save_file not allowed');
    const unknownKind = { kind: 'on-fire', path: '/a.png' };
    expect(fromCommandError(unknownKind, 'save')).toBe(unknownKind);
  });
});

describe('isCommandError', () => {
  it('accepts the shape the shell sends, with or without a detail', () => {
    expect(isCommandError({ kind: 'io', path: '/a.png' })).toBe(true);
    expect(isCommandError({ kind: 'io', path: '/a.png', detail: 'x' })).toBe(true);
  });

  it('refuses other values', () => {
    expect(isCommandError(null)).toBe(false);
    expect(isCommandError('not-found')).toBe(false);
    expect(isCommandError({ kind: 'io' })).toBe(false);
    expect(isCommandError({ kind: 'io', path: '/a.png', detail: 2 })).toBe(false);
  });
});
