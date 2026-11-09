/**
 * Errors of the animation export. Their `message` can be shown to the user (as with ExportError in
 * ../exporter.ts).
 */

/** What the user sees when this engine cannot encode a WebP animation. */
export const WEBP_ANIMATION_UNSUPPORTED = 'This system cannot encode WebP animations. Choose another format.';

/** What the user sees when this engine has no WebCodecs video encoder, so no MP4 at all. */
export const MP4_UNSUPPORTED =
  'This system cannot encode MP4 video. Choose GIF, or update the system: MP4 needs macOS 13.3 or later, or a recent WebKitGTK on Linux.';

/** What the user sees when the video encoder cannot encode MP4 at the chosen size and frame rate. */
export const MP4_SIZE_UNSUPPORTED =
  'This system cannot encode MP4 video at this size and frame rate. Choose a smaller size, fewer frames per second, or GIF.';

type AnimationErrorCode = 'unsupported' | 'webp-unsupported' | 'mp4-unsupported' | 'render-failed' | 'encode-failed';

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
export class AnimationCanceled extends Error {
  constructor() {
    super('The animation export was canceled.');
    this.name = 'AbortError';
  }
}

export function isAnimationCanceled(e: unknown): boolean {
  return e instanceof AnimationCanceled || (e instanceof DOMException && e.name === 'AbortError');
}
