/**
 * The errors of the desktop shell's file commands, turned into what the user sees: the shell sends
 * a kind and a path (`CommandError` in src-tauri/src/error.rs), and the message is written here, in
 * user terms, from the kind and the file name.
 */
import { UserError } from '../core/errors';

/** What went wrong; the same set as `ErrorKind` in src-tauri/src/error.rs. */
export type CommandErrorKind =
  | 'not-found'
  | 'permission-denied'
  | 'not-a-file'
  | 'too-large'
  | 'disk-full'
  | 'not-text'
  | 'io'
  | 'invalid-request';

/** The error a file command rejects with. */
export interface CommandError {
  kind: CommandErrorKind;
  /** The path the error concerns; empty for `invalid-request`. */
  path: string;
  /** The system's error text, or what was wrong with the request: for diagnostics only. */
  detail?: string;
}

/** What the user was doing with the file: saving it, or opening it from the system. */
export type FileAction = 'save' | 'open';

const KINDS: ReadonlySet<string> = new Set<CommandErrorKind>([
  'not-found',
  'permission-denied',
  'not-a-file',
  'too-large',
  'disk-full',
  'not-text',
  'io',
  'invalid-request',
]);

/** True for a value shaped like the error a file command rejects with. */
export function isCommandError(value: unknown): value is CommandError {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, path, detail } = value as Record<string, unknown>;
  return (
    typeof kind === 'string' &&
    KINDS.has(kind) &&
    typeof path === 'string' &&
    (detail === undefined || typeof detail === 'string')
  );
}

/** The last part of a Windows or POSIX path. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** The message the user sees for an error the user can act on (any kind but `invalid-request`). */
export function commandErrorMessage(error: CommandError, action: FileAction): string {
  const name = `“${fileName(error.path)}”`;
  if (action === 'save') {
    switch (error.kind) {
      case 'not-found':
        return `${name} could not be saved: its folder no longer exists. Choose another folder.`;
      case 'permission-denied':
        return `${name} could not be saved: the system does not allow writing there. Choose another folder.`;
      case 'not-a-file':
        return `${name} could not be saved: a folder of that name is already there. Choose another name.`;
      case 'too-large':
        return `${name} could not be saved: the file is too large for that drive. Choose another drive.`;
      case 'disk-full':
        return `${name} could not be saved: the drive is full. Free some space or choose another drive.`;
      default:
        return `${name} could not be saved. Try again, or choose another folder.`;
    }
  }
  switch (error.kind) {
    case 'not-found':
      return `${name} could not be opened: the file no longer exists, or it was moved. Open it from where it is now.`;
    case 'permission-denied':
      return `${name} could not be opened: the system does not allow reading it. Check the file’s permissions, then open it again.`;
    case 'not-a-file':
      return `${name} could not be opened: it is a folder or another item, not a file. Open a .mdproj project file.`;
    case 'not-text':
      return `${name} could not be opened: it is not a Mockup Director project, or it is damaged. Open another .mdproj file.`;
    default:
      return `${name} could not be opened. Check that the file is still there, then open it again.`;
  }
}

/**
 * What to report for a failed file command: a `UserError` with the message for its kind (the
 * shell's error as its cause), a plain `Error` for a malformed call, which is a bug, and anything
 * else unchanged (the command could not be called at all).
 */
export function fromCommandError(e: unknown, action: FileAction): unknown {
  if (!isCommandError(e)) return e;
  if (e.kind === 'invalid-request') {
    return new Error('The desktop shell refused the request', { cause: e });
  }
  return new UserError(commandErrorMessage(e, action), { cause: e });
}
