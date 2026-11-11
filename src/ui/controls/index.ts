/**
 * What every inspector control is, and how a tab registers the controls it syncs. A control reads its value
 * through `get()` and writes it through `set()`; `sync()` refreshes its element from the state without rebuilding
 * it, so focus and drag state are kept.
 */

/** An inspector control: its element and how to refresh it from the state. */
export interface Control {
  el: HTMLElement;
  sync(): void;
}

/** Registers a control so the tab syncs it with the store (in the order they were added), and returns it. */
export type AddControl = <T extends Control>(c: T) => T;
