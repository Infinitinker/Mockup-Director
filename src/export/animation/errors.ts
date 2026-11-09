/**
 * Errors of the animation export. `text` carries a Message so the UI's errorMessage() shows it in
 * the interface language; `message` is the English text (same convention as ExportError in ../exporter.ts).
 */
import { mtIn, type Message } from '../../i18n';

export type AnimationErrorCode =
  | 'unsupported'
  | 'webp-unsupported'
  | 'mp4-unsupported'
  | 'render-failed'
  | 'encode-failed';

export class AnimationError extends Error {
  readonly code: AnimationErrorCode;
  readonly text: Message;
  constructor(code: AnimationErrorCode, text: Message, cause?: unknown) {
    super(mtIn('en', text));
    this.name = 'AnimationError';
    this.code = code;
    this.text = text;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Thrown when the user cancels a running export (AbortSignal). Not an error for the UI. */
export class AnimationCancelled extends Error {
  constructor() {
    super('Animation export cancelled');
    this.name = 'AbortError';
  }
}

export function isAnimationCancelled(e: unknown): boolean {
  return e instanceof AnimationCancelled || (e instanceof DOMException && e.name === 'AbortError');
}
