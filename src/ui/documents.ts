/**
 * The open projects, one per tab. The store works on the active one; the others wait here as
 * StoreDocuments (state, undo history, artwork). There is always at least one tab.
 *
 * A tab is "dirty" (changed since it was opened, created or saved) when its revision differs from
 * the one it was saved at; undoing back to that point makes it clean again.
 */
import { Store, type DocumentState, type StoreDocument } from './state';
import { log } from '../platform/log';

export interface TabInfo {
  readonly id: string;
  /** The project's name (its file name without the extension); '' for a project never saved. */
  readonly name: string;
  /** For tabs without a name: 1 for the first ("Untitled"), 2 for "Untitled 2", … */
  readonly untitledNumber: number;
  readonly dirty: boolean;
  readonly active: boolean;
}

/** What the session autosave needs of a tab. */
export interface TabSnapshot {
  readonly id: string;
  readonly name: string;
  readonly dirty: boolean;
  readonly revision: number;
  readonly state: DocumentState;
}

interface AddOptions {
  name?: string;
  /** The tab starts with unsaved changes (e.g. restored unsaved work). */
  dirty?: boolean;
  /** Switch to the new tab (default: true). */
  activate?: boolean;
  /** Keep this id (restored tabs); a new one is made otherwise. */
  id?: string;
  /** Where the tab goes: next to the active tab (default), or last (restoring tabs in order). */
  position?: 'next' | 'end';
}

interface Entry {
  id: string;
  name: string;
  untitledNumber: number;
  /** The revision the tab was last saved (or opened / created) at; -1: never matches. */
  savedRevision: number;
  /** null while the tab is active: its document is in the store. */
  doc: StoreDocument | null;
}

let idCounter = 0;
const newId = () => `tab-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;

export class Documents {
  private entries: Entry[];
  private active: Entry;
  private listeners = new Set<() => void>();
  private lastDirty: boolean;
  /** True during store.swap(): its change notification comes while the tabs are half switched. */
  private switching = false;

  /**
   * @param store the store, holding the first tab's document
   * @param fresh makes the state of an empty project (for a new tab, or when the last tab closes)
   */
  constructor(
    private readonly store: Store,
    private readonly fresh: () => DocumentState,
  ) {
    this.active = { id: newId(), name: '', untitledNumber: 1, savedRevision: store.revision, doc: null };
    this.entries = [this.active];
    this.lastDirty = false;
    store.subscribe(() => {
      if (this.switching) return;
      // Edits only matter to the tabs when they change whether the active tab is dirty.
      const dirty = this.isDirty(this.active);
      if (dirty !== this.lastDirty) {
        this.lastDirty = dirty;
        this.emit();
      }
    });
  }

  /** Called when tabs are added, closed, renamed, switched or become dirty or clean. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get activeId(): string {
    return this.active.id;
  }

  tabs(): TabInfo[] {
    return this.entries.map((e) => ({
      id: e.id,
      name: e.name,
      untitledNumber: e.untitledNumber,
      dirty: this.isDirty(e),
      active: e === this.active,
    }));
  }

  tab(id: string): TabInfo | undefined {
    return this.tabs().find((t) => t.id === id);
  }

  /** True when the active tab is an untouched new project, which an opened file may replace. */
  activeIsPristine(): boolean {
    return this.active.name === '' && !this.isDirty(this.active) && !this.store.canUndo;
  }

  /** Adds a tab holding `state`; returns its id. */
  add(state: DocumentState, opts: AddOptions = {}): string {
    const doc = Store.createDocument(state);
    const entry: Entry = {
      id: opts.id ?? newId(),
      name: opts.name ?? '',
      untitledNumber: opts.name ? 0 : this.freeUntitledNumber(),
      savedRevision: opts.dirty ? -1 : doc.revision,
      doc,
    };
    const at = opts.position === 'end' ? this.entries.length : this.entries.indexOf(this.active) + 1;
    this.entries.splice(at, 0, entry);
    if (opts.activate ?? true) this.activate(entry.id);
    else this.emit();
    return entry.id;
  }

  /** Puts the tab's project into the store. */
  activate(id: string): void {
    const next = this.entries.find((e) => e.id === id);
    if (!next || next === this.active || !next.doc) return;
    const incoming = next.doc;
    this.switching = true;
    try {
      this.active.doc = this.store.swap(incoming);
    } finally {
      this.switching = false;
    }
    next.doc = null;
    this.active = next;
    this.lastDirty = this.isDirty(next);
    this.emit();
  }

  /** Switches to the next (+1) or previous (-1) tab, wrapping around. */
  cycle(step: 1 | -1): void {
    const i = this.entries.indexOf(this.active);
    const n = this.entries.length;
    this.activate(this.entries[(i + step + n) % n].id);
  }

  /** Closes a tab and frees its project. Closing the last tab leaves a new empty project. */
  close(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (this.entries.length === 1) this.add(this.fresh());
    if (entry === this.active) {
      const i = this.entries.indexOf(entry);
      const neighbor = this.entries[i + 1] ?? this.entries[i - 1];
      this.activate(neighbor.id);
    }
    this.entries = this.entries.filter((e) => e !== entry);
    if (entry.doc) Store.disposeDocument(entry.doc);
    this.emit();
  }

  /**
   * Records that a tab was saved under `name`, as it was at `revision` (taken before the save
   * started: edits made while the file was written stay unsaved). Nothing happens when the tab was
   * closed meanwhile.
   */
  markSaved(id: string, revision: number, name: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.name = name;
    entry.untitledNumber = 0;
    entry.savedRevision = revision;
    if (entry === this.active) this.lastDirty = this.isDirty(entry);
    this.emit();
  }

  /** Records that the active tab now holds a project opened from a file (see Store.replace). */
  markActiveOpened(name: string): void {
    this.markSaved(this.active.id, this.store.revision, name);
  }

  /** Every tab with its current state, in tab order (for the session autosave). */
  snapshot(): TabSnapshot[] {
    return this.entries.map((e) => {
      const isActive = e === this.active;
      const state: DocumentState = isActive ? { ...this.store.state } : this.parkedDoc(e).state;
      const revision = isActive ? this.store.revision : this.parkedDoc(e).revision;
      return { id: e.id, name: e.name, dirty: this.isDirty(e), revision, state };
    });
  }

  /* ---------------------------------------------------------------- */

  private isDirty(e: Entry): boolean {
    const revision = e === this.active ? this.store.revision : this.parkedDoc(e).revision;
    return revision !== e.savedRevision;
  }

  /** The document of a tab that is not active (the active tab's document is in the store). */
  private parkedDoc(e: Entry): StoreDocument {
    if (!e.doc) throw new Error(`The inactive tab ${e.id} has no document.`);
    return e.doc;
  }

  private freeUntitledNumber(): number {
    const used = new Set(this.entries.map((e) => e.untitledNumber));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  private emit(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        log.error('A tabs listener failed', e);
      }
    }
  }
}
