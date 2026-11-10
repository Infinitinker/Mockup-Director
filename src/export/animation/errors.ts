/**
 * What the animation export tells the user when this engine cannot encode a format, and the error that
 * ends an export the user canceled.
 */

/** What the user sees when this engine cannot encode a WebP animation. */
export const WEBP_ANIMATION_UNSUPPORTED = 'This system cannot encode WebP animations. Choose another format.';

/** What the user sees when this engine has no WebCodecs video encoder, so no MP4 at all. */
export const MP4_UNSUPPORTED =
  'This system cannot encode MP4 video. Choose GIF, or update the system: MP4 needs macOS 13.3 or later, or a recent WebKitGTK on Linux.';

/** What the user sees when the video encoder cannot encode MP4 at the chosen size and frame rate. */
export const MP4_SIZE_UNSUPPORTED =
  'This system cannot encode MP4 video at this size and frame rate. Choose a smaller size, fewer frames per second, or GIF.';

/** Thrown when the user cancels a running export (AbortSignal). Not an error for the UI. */
export class AnimationCanceled extends Error {
  constructor() {
    super('The animation export was canceled.');
    this.name = 'AbortError';
  }
}

/** Whether `e` ended the export because the user canceled it. */
export function isAnimationCanceled(e: unknown): boolean {
  return e instanceof AnimationCanceled;
}
