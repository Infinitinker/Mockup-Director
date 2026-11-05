/**
 * Errors of the animation export. `text` carries a LocalizedText so the UI's errorMessage() shows
 * the message in the interface language (same convention as ExportError in ../exporter.ts).
 */
import type { LocalizedText } from '../../core/types';

export type AnimationErrorCode =
  | 'unsupported'
  | 'webp-unsupported'
  | 'mp4-unsupported'
  | 'render-failed'
  | 'encode-failed';

export class AnimationError extends Error {
  readonly code: AnimationErrorCode;
  readonly text: LocalizedText;
  constructor(code: AnimationErrorCode, text: LocalizedText, cause?: unknown) {
    super(`${text.pl} / ${text.en}`);
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
