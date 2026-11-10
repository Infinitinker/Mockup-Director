/**
 * Logs the errors no code catches from the moment it is imported: `main.ts` imports it first, so that
 * errors thrown while the other modules are evaluated are logged too.
 */
import { logUncaughtErrors } from './log';

logUncaughtErrors();
