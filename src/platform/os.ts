/**
 * The operating system the app runs on, as far as the interface needs to know it.
 */

/** True on macOS (and Apple's mobile systems), where shortcuts use ⌘ instead of Ctrl. */
export const isMac: boolean = /Mac|iPhone|iPad|iPod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent,
);
