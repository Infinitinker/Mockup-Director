/**
 * Errors of the animation export. Their `message` can be shown to the user (as with ExportError in
 * ../exporter.ts).
 */

export type AnimationErrorCode =
  | 'unsupported'
  | 'webp-unsupported'
  | 'mp4-unsupported'
  | 'render-failed'
  | 'encode-failed';

export class AnimationError extends Error {
  readonly code: AnimationErrorCode;
  constructor(code: AnimationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AnimationError';
    this.code = code;
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
