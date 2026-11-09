/**
 * Errors of the 3D stage whose message can be shown to the user.
 */

/** Stage failure with a message that can be shown to the user. */
export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageError';
  }
}
