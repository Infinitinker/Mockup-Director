/**
 * Centre viewport: the stage host, floating view bar and the file drop overlay.
 */
import { h } from './dom';
import { ICONS } from './icons';
import { t } from '../i18n';
import { VIEW_PRESETS, type AppContext } from './context';
import { hasAny } from './state';
import { isProjectFileName } from './project';
import type { BackgroundSettings, CameraSettings } from '../core/types';
import { applyCssBackground } from '../scene/background';
import { segmentedControl, type Control } from './controls';

export interface ViewportShell {
  el: HTMLElement;
  /** Element the stage renders into. */
  host: HTMLElement;
  mount(ctx: AppContext): void;
  showError(message: string): void;
}

/** CSS background for the preview (also visible when the stage renders with alpha). */
export function applyPreviewBackground(el: HTMLElement, bg: BackgroundSettings): void {
  // Same implementation as the stage wrapper and the exporter (scene/background.ts), so the host
  // (visible only before the stage exists or when WebGL is unavailable) can never drift from them.
  el.classList.remove('checkerboard');
  applyCssBackground(el, bg);
}

function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|svg)$/i.test(f.name);
}
function isProjectFile(f: File): boolean {
  return isProjectFileName(f.name);
}

export function createViewportShell(): ViewportShell {
  const host = h('div', { class: 'stage-host' });
  const overlay = h('div', { class: 'drop-overlay', attrs: { 'aria-hidden': 'true' } });
  const bar = h('div', { class: 'viewbar glass', attrs: { role: 'toolbar' } });
  const hint = h('div', { class: 'viewport-hint' });
  const errorBox = h('div', { class: 'viewport-error', attrs: { role: 'alert', hidden: true } });
  const el = h('main', { class: 'viewport' }, host, hint, errorBox, bar, overlay);

  let ctx: AppContext | null = null;
  let controls: Control[] = [];

  const setCamera = (patch: Partial<CameraSettings>) => {
    if (!ctx) return;
    ctx.store.update(['camera'], (s) => {
      s.scene.camera = { ...s.scene.camera, ...patch };
    });
  };

  const renderBar = () => {
    if (!ctx) return;
    const c = ctx;
    bar.replaceChildren();
    bar.setAttribute('aria-label', t('viewBar'));
    const views = h('div', { class: 'vb-group' });
    VIEW_PRESETS.forEach((v, i) => {
      views.appendChild(
        h('button', {
          class: 'vb-btn',
          text: t(v.key),
          title: `${t(v.key)} (${i + 1})`,
          attrs: { type: 'button' },
          on: { click: () => c.actions.setView(i) },
        }),
      );
    });
    const reset = h(
      'button',
      {
        class: 'vb-btn vb-icon',
        title: t('resetView'),
        label: t('resetView'),
        attrs: { type: 'button' },
        on: { click: () => c.actions.resetView() },
      },
      h('span', { class: 'btn-icon', html: ICONS.reset }),
    );
    const proj = segmentedControl<CameraSettings['projection']>({
      compact: true,
      ariaLabel: t('projection'),
      options: [
        { value: 'perspective', label: '', icon: ICONS.perspective, title: t('perspective') },
        { value: 'orthographic', label: '', icon: ICONS.ortho, title: t('orthographic') },
      ],
      get: () => c.store.state.scene.camera.projection,
      set: (v) => setCamera({ projection: v }),
    });
    const bg = segmentedControl<BackgroundSettings['mode']>({
      compact: true,
      ariaLabel: t('previewBackground'),
      options: [
        { value: 'transparent', label: '', icon: ICONS.checker, title: t('bgTransparent') },
        { value: 'color', label: '', icon: ICONS.fill, title: t('bgColor') },
        { value: 'gradient', label: '', icon: ICONS.gradient, title: t('bgGradient') },
      ],
      get: () => c.store.state.scene.background.mode,
      set: (v) =>
        c.store.update(['scene'], (s) => {
          s.scene.background.mode = v;
        }),
    });
    proj.el.title = t('projection');
    bg.el.title = t('previewBackground');
    controls = [proj, bg];
    bar.append(
      views,
      h('div', { class: 'vb-sep' }),
      reset,
      h('div', { class: 'vb-sep' }),
      proj.el,
      h('div', { class: 'vb-sep' }),
      bg.el,
    );
    hint.textContent = t('viewportHint');
    overlay.replaceChildren(
      h(
        'div',
        { class: 'drop-card' },
        h('span', { class: 'drop-icon', html: ICONS.image }),
        h('div', { text: t('dropHere') }),
      ),
    );
  };

  const sync = () => {
    if (!ctx) return;
    controls.forEach((c) => c.sync());
    applyPreviewBackground(host, ctx.store.state.scene.background);
  };

  /* Drag & drop of image / project files ------------------------------ */
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    el.classList.add('dragging');
  });
  el.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.classList.remove('dragging');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.classList.remove('dragging');
    if (!ctx) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const project = files.find(isProjectFile);
    if (project) {
      void ctx.actions.openProject(project);
      return;
    }
    const images = files.filter(isImageFile);
    if (images.length) void ctx.actions.assignImages(images);
  });

  return {
    el,
    host,
    mount(c: AppContext) {
      ctx = c;
      renderBar();
      sync();
      c.store.subscribe((e) => {
        if (e.kinds.has('lang')) renderBar();
        if (hasAny(e, 'scene', 'camera', 'lang')) sync();
      });
    },
    showError(message: string) {
      errorBox.hidden = false;
      errorBox.textContent = message;
    },
  };
}
