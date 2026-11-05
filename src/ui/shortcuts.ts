/**
 * Keyboard shortcuts: ⌘ on macOS, Ctrl elsewhere.
 *  ⌘N new · ⌘O open · ⌘S save · ⌘E export · ⌘Z undo · ⇧⌘Z redo (also Ctrl+Y off-mac) · 1–6 preset views.
 */
import { isMac, isTextEditing } from './dom';
import { VIEW_PRESETS, type AppContext } from './context';

export function installShortcuts(ctx: AppContext): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    // Ignore while a modal dialog is open.
    if (document.querySelector('.modal-backdrop:not(.closing)')) return;
    const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const a = ctx.actions;

    if (mod && !e.altKey) {
      switch (key) {
        case 'n':
          e.preventDefault();
          void a.newProject();
          return;
        case 'o':
          e.preventDefault();
          void a.openProject();
          return;
        case 's':
          e.preventDefault();
          void a.saveProject();
          return;
        case 'e':
          e.preventDefault();
          void a.exportImage();
          return;
        case 'z':
          // Inside text fields keep the native text undo.
          if (isTextEditing(e.target)) return;
          e.preventDefault();
          if (e.shiftKey) a.redo();
          else a.undo();
          return;
        case 'y':
          if (isMac || isTextEditing(e.target)) return;
          e.preventDefault();
          a.redo();
          return;
      }
      return;
    }

    if (!e.metaKey && !e.ctrlKey && !e.altKey && !isTextEditing(e.target)) {
      // e.code keeps digits working on keyboard layouts where the number row needs Shift.
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code) ?? /^([1-9])$/.exec(e.key);
      if (m) {
        const idx = Number(m[1]) - 1;
        if (idx < VIEW_PRESETS.length) {
          e.preventDefault();
          a.setView(idx);
        }
      }
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
