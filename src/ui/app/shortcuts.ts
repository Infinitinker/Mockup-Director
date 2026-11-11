/**
 * Keyboard shortcuts: ⌘ on macOS, Ctrl elsewhere.
 *  ⌘N / ⌘T new project tab · ⌘O open · ⌘S save · ⌘W close the tab · ⌘E export · ⌘Z undo ·
 *  ⇧⌘Z redo (also Ctrl+Y off-mac) · 1–6 preset views.
 *  Next / previous tab: Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp everywhere (also on
 *  macOS, like its browsers), plus ⇧⌘] / ⇧⌘[ on macOS.
 */
import { isTextEditing } from '../dom';
import { isMac } from '../../platform/os';
import type { AppContext } from '../context';
import { VIEW_PRESETS } from '../../scene/views';

export function installShortcuts(ctx: AppContext): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    // Ignore while a modal dialog is open.
    if (document.querySelector('.modal-backdrop:not(.closing)')) return;
    const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const a = ctx.actions;

    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault();
      a.switchProject(e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1);
      return;
    }
    if (isMac && e.metaKey && e.shiftKey && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault();
      a.switchProject(e.code === 'BracketLeft' ? -1 : 1);
      return;
    }

    if (mod && !e.altKey) {
      switch (key) {
        case 'n':
        case 't':
          e.preventDefault();
          void a.newProject();
          return;
        case 'w':
          e.preventDefault();
          void a.closeProject();
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
