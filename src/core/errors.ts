/**
 * The error the user sees: `UserError`, whose message is written for the user. Every other error is
 * a bug or a failure of the system, and is shown through `errorMessage` in `src/ui/errors.ts`.
 */

/**
 * An error whose message is written for the user, in user terms: what happened, then what to do
 * ("Not enough memory to load an image this large. Choose a smaller image."). The interface shows
 * the message as it is.
 */
export class UserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserError';
  }
}
