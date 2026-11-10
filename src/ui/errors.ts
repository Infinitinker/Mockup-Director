/**
 * How the interface reports an error: the message it shows for any error, and the log entry
 * written when it shows one.
 */
import { UserError } from '../core/errors';
import { log } from '../platform/log';

/**
 * What the interface says about an error: a UserError's own message; for anything else (a bug, a
 * failure of the web engine, a value that is not an Error) a general message with the raw text as
 * detail. Written to follow the title of an error toast.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  let raw: string;
  if (e instanceof Error) raw = e.message || e.name;
  else if (typeof e === 'string') raw = e;
  else {
    try {
      raw = JSON.stringify(e) ?? String(e);
    } catch {
      raw = String(e);
    }
  }
  const detail = raw.trim().replace(/\.+$/, '');
  return `Something unexpected went wrong${detail ? `: ${detail}` : ''}. If it keeps happening, report it at github.com/Infinitinker/Mockup-Director/issues.`;
}

/**
 * Logs an error the interface shows, under a short title naming what failed (usually the title it is
 * shown with): a UserError as a warning (the user was told what to do), anything else as an error.
 */
export function logShownError(title: string, e: unknown): void {
  if (e instanceof UserError) log.warn(title, e);
  else log.error(title, e);
}
