/**
 * The app's diagnostics. In the desktop app entries go to the log file the shell writes
 * (`write_log` in src-tauri/src/log.rs); in a browser, and in a build run from source, to the
 * console. Every module may use it. Never log artwork or file contents: an error whose message
 * quotes a file (such as a JSON parser's) is logged without it.
 */
import { invoke } from '@tauri-apps/api/core';
import { inDesktopApp } from './files';

export type LogLevel = 'info' | 'warn' | 'error';

/** Entries longer than this are cut, so that a runaway message cannot fill the log. */
export const MAX_ENTRY_LENGTH = 8000;

/** How many causes of an error are described. */
const MAX_CAUSES = 5;

/** Writes an entry somewhere; failures are its own to handle. */
type Sink = (level: LogLevel, text: string) => void;

function toConsole(level: LogLevel, text: string): void {
  // biome-ignore lint/suspicious/noConsole: the console is where the log goes outside the desktop app.
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(text);
}

function toShell(level: LogLevel, text: string): void {
  invoke('write_log', { level, message: text }).catch((e: unknown) => {
    toConsole('error', `Cannot write to the log: ${describeError(e)}`);
    toConsole(level, text);
  });
  if (import.meta.env.DEV) toConsole(level, text);
}

let sink: Sink | null = null;

/** Where entries go: chosen at the first entry, when the page knows whether it runs in the desktop app. */
function currentSink(): Sink {
  sink ??= inDesktopApp() ? toShell : toConsole;
  return sink;
}

/** One error and its causes as text: name, message and stack. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSES && current !== undefined; depth++) {
    parts.push((depth === 0 ? '' : 'Caused by: ') + describeOne(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join('\n');
}

function describeOne(error: unknown): string {
  if (!(error instanceof Error)) return describeValue(error);
  // A SyntaxError's message may quote the text being parsed: a file's contents.
  const head = error instanceof SyntaxError ? error.name : `${error.name}: ${error.message}`;
  const frames = framesOf(error);
  return frames ? `${head}\n${frames}` : head;
}

/** The frames of an error's stack, without the name and message V8 puts before them. */
function framesOf(error: Error): string {
  const lines = (error.stack ?? '').split('\n');
  const v8 = lines.findIndex((line) => /^\s+at /.test(line));
  if (v8 >= 0) return lines.slice(v8).join('\n');
  // WebKit lists only the frames; a stack that holds the message is not one of those.
  const stack = lines.join('\n').trim();
  return error.message && stack.includes(error.message) ? '' : stack;
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The entry as written: the message, then the error if there is one, cut to MAX_ENTRY_LENGTH. */
export function formatEntry(message: string, error?: unknown): string {
  const text = error === undefined ? message : `${message}\n${describeError(error)}`;
  if (text.length <= MAX_ENTRY_LENGTH) return text;
  // Never cut between the two halves of a character outside the BMP (an emoji): the shell refuses half a character.
  const last = text.charCodeAt(MAX_ENTRY_LENGTH - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_ENTRY_LENGTH - 1 : MAX_ENTRY_LENGTH;
  return `${text.slice(0, end)} [${text.length - end} more characters left out]`;
}

function write(level: LogLevel, message: string, error?: unknown): void {
  currentSink()(level, formatEntry(message, error));
}

/** Logs to the log file in the desktop app, to the console elsewhere. */
export const log = {
  /** Something worth knowing when reading the log, such as a choice the app made. */
  info: (message: string): void => write('info', message),
  /** A problem the app worked around. */
  warn: (message: string, error?: unknown): void => write('warn', message, error),
  /** A failure. */
  error: (message: string, error?: unknown): void => write('error', message, error),
};

/** Logs the errors no code catches: uncaught exceptions and rejected promises nobody handles. */
export function logUncaughtErrors(): void {
  window.addEventListener('error', (e) => log.error('Uncaught error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => log.error('Unhandled rejection', e.reason));
}
